# usage: python3 diff.py <dir> <style> [first:second=a:b]
# Prints the share of pixels that change between two frames and where,
# and writes <style>.<first>-<second>.diff.png: the frame greyed, changes
# over 24 in red, over 8 in orange.
import signal
import sys
import numpy as np
from PIL import Image

signal.signal(signal.SIGPIPE, signal.SIG_DFL)  # piping into head is fine
d, style = sys.argv[1], sys.argv[2]
first, second = (sys.argv[3] if len(sys.argv) > 3 else "a:b").split(":")
pair = f"{first}-{second}"
a = np.asarray(Image.open(f"{d}/{style}.{first}.png").convert("RGB")).astype(np.int16)
b = np.asarray(Image.open(f"{d}/{style}.{second}.png").convert("RGB")).astype(np.int16)
delta = np.abs(a - b).max(axis=2)
h, w = delta.shape
changed = delta > 24
print(f"{style} {pair}: changed {changed.mean()*100:.2f} % (>24), mean delta {delta.mean():.2f}")
bands = 6
for i in range(bands):
    s = changed[i*h//bands:(i+1)*h//bands]
    print(f"  rows {i*h//bands:4d}-{(i+1)*h//bands:4d}: {s.mean()*100:6.2f} %")
grey = a.mean(axis=2, keepdims=True).repeat(3, axis=2) * 0.5 + 64
out = grey.copy()
mask = delta > 8
out[mask] = [255, 0, 0]
out[mask & (delta <= 24)] = [255, 170, 0]
Image.fromarray(out.clip(0, 255).astype(np.uint8)).save(f"{d}/{style}.{pair}.diff.png")
