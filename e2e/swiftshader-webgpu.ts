/**
 * The launch options that let a headless Chromium draw the scene without a
 * GPU: WebGPU from Dawn on SwiftShader's Vulkan, and Chrome's own Vulkan
 * on SwiftShader too — without it the canvas's swap chain finds no shared
 * image to present into and takes the GPU process down. The viewer specs
 * and the snapshot harness's container path (`SHOTS_SMALL=1`) share them;
 * the scene has no WebGL2 path to fall back to (ADR 0027).
 */
import type { LaunchOptions } from "@playwright/test";

export const SWIFTSHADER_WEBGPU: LaunchOptions = {
  // the config's browser outside Playwright's store (playwright.config.ts)
  executablePath: process.env.PW_CHROMIUM,
  args: [
    "--enable-unsafe-webgpu",
    "--use-webgpu-adapter=swiftshader",
    "--enable-features=Vulkan",
    "--use-vulkan=swiftshader",
    "--use-angle=swiftshader",
  ],
};
