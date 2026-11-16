/**
 * Plan 091 phase 2: whether the GPU reads our blocks as our decoders say.
 * Encodes Dresden's spawn tile's sky view as BC4 and as EAC R11
 * (scripts/block-encode.ts), uploads each level 0 to a WebGPU texture of
 * its format in a headless Chromium (SwiftShader's Vulkan, the e2e's
 * flags), reads every texel back with `textureLoad` in a fragment pass (a
 * compute pass reads compressed textures as zeros there) and
 * compares with `decodeLevel`. Prints the adapter's compression features
 * and the largest difference, in byte steps.
 * `bun scripts/eval/block-raster-probe.ts [png]`; with `--known`, prints
 * what the GPU reads from scripts/block-known.ts's blocks instead.
 */
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import type { Page } from "playwright";
import { parseBlockRaster } from "../../lib/city/block-raster";
import type { BlockFormat, BlockLevel } from "../../lib/city/block-raster";
import { decodeGreyPng } from "../../lib/city/png-raster";
import { SWIFTSHADER_WEBGPU } from "../../e2e/swiftshader-webgpu";
import { decodeLevel, encodeBlockRaster } from "../block-encode";
import { knownLevel } from "../block-known";

const png =
  process.argv.slice(2).find((a) => !a.startsWith("--")) ??
  "data/dresden/dlm/svf_33412_5656_2_sn.png";
const grey = await decodeGreyPng(readFileSync(png));

const GPU_FORMAT: Record<BlockFormat, string> = {
  bc4: "bc4-r-unorm",
  eac: "eac-r11unorm",
};

const server = Bun.serve({
  port: 0,
  fetch: () =>
    new Response("<!doctype html><title>probe</title>", {
      headers: { "content-type": "text/html" },
    }),
});
const browser = await chromium.launch({
  ...SWIFTSHADER_WEBGPU,
  executablePath: process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium",
});
/** What the GPU reads from every texel of `level`, × 255 (a fragment
 *  pass into r32float), and the adapter's compression features. */
async function gpuRead(
  page: Page,
  level: BlockLevel,
  format: BlockFormat
): Promise<{ features: string[]; values: number[] }> {
  return await page.evaluate(
    async ({ blocks, width, height, gpuFormat, feature }) => {
      // (the WebGPU flags by value: the scripts' types have no DOM GPU
      // globals)
      const TEXTURE_BINDING = 4;
      const RENDER_ATTACHMENT = 16;
      const COPY_SRC = 1;
      const COPY_DST = 2;
      const MAP_READ = 1;
      const BUFFER_COPY_DST = 8;
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) {
        throw new Error("no adapter");
      }
      const features = [...adapter.features].filter((f) =>
        f.startsWith("texture-compression")
      );
      const device = await adapter.requestDevice({
        requiredFeatures: [feature as GPUFeatureName],
      });
      device.pushErrorScope("validation");
      const texture = device.createTexture({
        size: [width, height],
        format: gpuFormat as GPUTextureFormat,
        usage: TEXTURE_BINDING | COPY_DST,
      });
      const data = new Uint8Array(blocks);
      device.queue.writeTexture(
        { texture },
        data,
        { bytesPerRow: (width / 4) * 8, rowsPerImage: height / 4 },
        [width, height]
      );
      // a fragment pass, as the scene samples it: SwiftShader reads a
      // compressed texture in a compute pass as zeros
      const target = device.createTexture({
        size: [width, height],
        format: "r32float",
        usage: RENDER_ATTACHMENT | COPY_SRC,
      });
      const back = device.createBuffer({
        size: width * height * 4,
        usage: MAP_READ | BUFFER_COPY_DST,
      });
      const shader = device.createShaderModule({
        code: `
@group(0) @binding(0) var t: texture_2d<f32>;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
let p = array(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
return vec4f(p[i], 0, 1);
}
@fragment fn fs(@builtin(position) p: vec4f) -> @location(0) vec4f {
return vec4f(textureLoad(t, vec2i(p.xy), 0).r, 0, 0, 1);
}`,
      });
      const pipeline = device.createRenderPipeline({
        layout: "auto",
        vertex: { module: shader, entryPoint: "vs" },
        fragment: {
          module: shader,
          entryPoint: "fs",
          targets: [{ format: "r32float" }],
        },
      });
      const bind = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: texture.createView() }],
      });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          { view: target.createView(), loadOp: "clear", storeOp: "store" },
        ],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bind);
      pass.draw(3);
      pass.end();
      encoder.copyTextureToBuffer(
        { texture: target },
        { buffer: back, bytesPerRow: width * 4 },
        [width, height]
      );
      device.queue.submit([encoder.finish()]);
      const error = await device.popErrorScope();
      if (error) {
        throw new Error(error.message);
      }
      await back.mapAsync(MAP_READ);
      const values = [...new Float32Array(back.getMappedRange())].map(
        (v) => v * 255
      );
      return { features, values };
    },
    {
      blocks: [...level.data],
      width: level.width,
      height: level.height,
      gpuFormat: GPU_FORMAT[format],
      feature:
        format === "bc4"
          ? "texture-compression-bc"
          : "texture-compression-etc2",
    }
  );
}

/** `--known`: what the GPU reads from the designed blocks
 *  (scripts/block-known.ts) as the integers SwiftShader returns — whole
 *  bytes for BC4, the 11-bit value (its read × 65 535 / 32) for EAC — for
 *  the known answers `scripts/block-encode.test.ts` pins. */
async function printKnown(page: Page): Promise<void> {
  const out: Record<string, number[]> = {};
  for (const format of ["bc4", "eac"] as const) {
    const read = await gpuRead(page, knownLevel(format), format);
    out[format] = read.values.map((v) =>
      format === "bc4" ? Math.round(v) : Math.round((v / 255) * (65_535 / 32))
    );
  }
  process.stdout.write(`${JSON.stringify(out)}\n`);
}

try {
  const page = await browser.newPage();
  await page.goto(`http://localhost:${server.port}/`);
  if (process.argv.includes("--known")) {
    await printKnown(page);
  }
  for (const format of process.argv.includes("--known")
    ? []
    : (["bc4", "eac"] as const)) {
    const level = parseBlockRaster(encodeBlockRaster(grey, format)).levels[0];
    const ours = decodeLevel(level, format);
    const read = await gpuRead(page, level, format);
    let worst = 0;
    let worstAt = 0;
    let over = 0;
    for (let i = 0; i < ours.length; i += 1) {
      const d = Math.abs(read.values[i] - ours[i]);
      if (d > 0.5) {
        over += 1;
      }
      if (d > worst) {
        worst = d;
        worstAt = i;
      }
    }
    if (process.env.PROBE_DEBUG) {
      process.stdout.write(
        `${over} texels off by > 0.5; worst at ${worstAt % level.width},${Math.floor(worstAt / level.width)}: gpu ${read.values[worstAt]} ours ${ours[worstAt]} src ${grey.data[worstAt]}\n`
      );
      process.stdout.write(
        `first: gpu ${read.values
          .slice(0, 8)
          .map((v) => v.toFixed(2))
          .join(",")} ours ${Array.from(ours.subarray(0, 8), (v) =>
          v.toFixed(2)
        ).join(",")}\n`
      );
    }
    process.stdout.write(
      `${format}: adapter ${read.features.join(" ")}; GPU vs decoder max ${worst.toFixed(4)} byte steps over ${ours.length} texels\n`
    );
  }
} finally {
  await browser.close();
  await server.stop();
}
