# usage: python3 flicker.py <dir> <style>
# Flicker in motion: pixels whose value goes one way between two moved
# frames and back the next (b→m1→m2→m3), each step by more than 24 —
# motion changes a pixel steadily, flicker toggles it. Writes
# <style>.flicker.png (the toggling pixels red over the frame, greyed).
import signal
import sys
import numpy as np
from PIL import Image

signal.signal(signal.SIGPIPE, signal.SIG_DFL)  # piping into head is fine
d, style = sys.argv[1], sys.argv[2]
fr = [np.asarray(Image.open(f"{d}/{style}.{k}.png").convert("L")).astype(np.int16) for k in ["b", "m1", "m2", "m3"]]
steps = [fr[i + 1] - fr[i] for i in range(3)]
toggle = np.zeros(fr[0].shape, bool)
for i in range(2):
    a, b = steps[i], steps[i + 1]
    toggle |= ((a > 24) & (b < -24)) | ((a < -24) & (b > 24))
h = toggle.shape[0]
print(f"{style}: toggling {toggle.mean()*100:.2f} %")
for i in range(6):
    print(f"  rows {i*h//6:4d}-{(i+1)*h//6:4d}: {toggle[i*h//6:(i+1)*h//6].mean()*100:6.2f} %")
rgb = np.asarray(Image.open(f"{d}/{style}.b.png").convert("RGB")).astype(np.float32)
grey = rgb.mean(axis=2, keepdims=True).repeat(3, axis=2) * 0.5 + 64
grey[toggle] = [255, 0, 0]
Image.fromarray(grey.astype(np.uint8)).save(f"{d}/{style}.flicker.png")
