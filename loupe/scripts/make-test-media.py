#!/usr/bin/env python3
"""Generate a varied test library: many formats, nested folders, EXIF dates,
orientation flags, HEIC, RAW, videos in several codecs, duplicates and
deliberately broken files.

Usage: python3 scripts/make-test-media.py [out_dir]
Requires: pillow, pillow-heif (pip), ffmpeg (uses node_modules/ffmpeg-static).
"""
import os
import random
import shutil
import struct
import subprocess
import sys
from datetime import datetime, timedelta

from PIL import Image, ImageDraw, ImageFilter
from PIL.TiffImagePlugin import IFDRational

try:
    import pillow_heif
    pillow_heif.register_heif_opener()
    HAVE_HEIF = True
except Exception:  # pragma: no cover
    HAVE_HEIF = False

ROOT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'test-data', 'varied'))
FFMPEG = os.path.join(os.path.dirname(__file__), '..', 'node_modules', 'ffmpeg-static', 'ffmpeg')
random.seed(7)


def scene(w, h, seed, label=''):
    rnd = random.Random(seed)
    top = tuple(rnd.randint(40, 200) for _ in range(3))
    bottom = tuple(rnd.randint(20, 160) for _ in range(3))
    img = Image.new('RGB', (w, h))
    d = ImageDraw.Draw(img)
    for y in range(0, h, 4):
        t = y / h
        c = tuple(int(top[i] * (1 - t) + bottom[i] * t) for i in range(3))
        d.rectangle([0, y, w, y + 4], fill=c)
    for _ in range(14):
        r = rnd.randint(w // 30, w // 6)
        x, y = rnd.randint(0, w), rnd.randint(0, h)
        col = tuple(rnd.randint(0, 255) for _ in range(3))
        d.ellipse([x - r, y - r, x + r, y + r], fill=col)
    img = img.filter(ImageFilter.GaussianBlur(radius=max(1, w // 400)))
    d = ImageDraw.Draw(img)
    if label:
        d.rectangle([0, h - h // 10, w, h], fill=(0, 0, 0))
        d.text((w // 40, h - h // 12), label, fill=(255, 255, 255))
    # An arrow pointing "up" makes orientation mistakes obvious.
    cx, cy, s = w // 2, h // 2, min(w, h) // 6
    d.polygon([(cx, cy - s), (cx - s // 2, cy), (cx + s // 2, cy)], fill=(255, 255, 255))
    d.rectangle([cx - s // 6, cy, cx + s // 6, cy + s], fill=(255, 255, 255))
    return img


def exif_bytes(dt, make='Canon', model='Canon EOS R6', orientation=1, gps=None, lens='RF24-105mm F4 L IS USM', iso=200):
    ex = Image.Exif()
    ex[0x010F] = make
    ex[0x0110] = model
    ex[0x0112] = orientation
    ex[0x0131] = 'Loupe test generator'
    ifd = ex.get_ifd(0x8769)
    ifd[0x9003] = dt.strftime('%Y:%m:%d %H:%M:%S')
    ifd[0x9004] = dt.strftime('%Y:%m:%d %H:%M:%S')
    ifd[0x8827] = iso
    ifd[0x829D] = IFDRational(4, 1)
    ifd[0x829A] = IFDRational(1, 250)
    ifd[0x920A] = IFDRational(50, 1)
    ifd[0xA434] = lens
    if gps:
        g = ex.get_ifd(0x8825)

        def dms(v):
            v = abs(v)
            d = int(v)
            m = int((v - d) * 60)
            s = round(((v - d) * 60 - m) * 60 * 100)
            return (IFDRational(d, 1), IFDRational(m, 1), IFDRational(s, 100))
        g[1] = 'N' if gps[0] >= 0 else 'S'
        g[2] = dms(gps[0])
        g[3] = 'E' if gps[1] >= 0 else 'W'
        g[4] = dms(gps[1])
    return ex.tobytes()


def write_bmp(path, img, bpp=24):
    w, h = img.size
    if bpp == 8:
        pal_img = img.convert('P', palette=Image.ADAPTIVE, colors=256)
        pal = pal_img.getpalette()[:768]
        stride = (w + 3) & ~3
        pixels = pal_img.tobytes()
        data = bytearray()
        for y in range(h - 1, -1, -1):
            row = pixels[y * w:(y + 1) * w]
            data += row + b'\0' * (stride - w)
        palette = bytearray()
        for i in range(256):
            r, g, b = pal[i * 3:i * 3 + 3] if i * 3 + 2 < len(pal) else (0, 0, 0)
            palette += bytes([b, g, r, 0])
        off = 14 + 40 + len(palette)
        header = b'BM' + struct.pack('<IHHI', off + len(data), 0, 0, off)
        dib = struct.pack('<IiiHHIIiiII', 40, w, h, 1, 8, 0, len(data), 2835, 2835, 256, 0)
        open(path, 'wb').write(header + dib + palette + data)
    else:
        img.save(path, 'BMP')


def ff(*args):
    subprocess.run([FFMPEG, '-hide_banner', '-loglevel', 'error', '-y', *args], check=True)


def main():
    if os.path.exists(ROOT):
        shutil.rmtree(ROOT)
    base = datetime(2026, 7, 4, 9, 30)
    trip = os.path.join(ROOT, 'Vacation 2026')

    beach = os.path.join(trip, 'Florida', 'Beach')
    os.makedirs(beach)
    for i in range(6):
        dt = base + timedelta(hours=i * 3)
        img = scene(4000, 3000, i, f'Beach {i}')
        orient = 6 if i == 2 else 1
        if orient == 6:
            img = img.transpose(Image.ROTATE_90)  # stored sideways, EXIF says rotate
        img.save(os.path.join(beach, f'IMG_{2840 + i}.JPG'), quality=90, exif=exif_bytes(dt, orientation=orient, gps=(26.1420, -81.7948)))

    ever = os.path.join(trip, 'Florida', 'Everglades')
    os.makedirs(ever)
    for i in range(3):
        dt = base + timedelta(days=1, hours=i)
        img = scene(4032, 3024, 100 + i, f'Everglades HEIC {i}')
        path = os.path.join(ever, f'IMG_{3000 + i}.HEIC')
        if HAVE_HEIF:
            img.save(path, quality=80, exif=exif_bytes(dt, make='Apple', model='iPhone 15 Pro', lens='iPhone 15 Pro back camera 6.86mm f/1.78', gps=(25.2866, -80.8987)))
        else:
            img.save(path.replace('.HEIC', '.jpg'))
    for i in range(2):
        dt = base + timedelta(days=1, hours=5 + i)
        img = scene(3000, 4000, 200 + i, f'Everglades portrait {i}')
        img.save(os.path.join(ever, f'gator_{i}.jpg'), quality=88, exif=exif_bytes(dt))

    atl = os.path.join(trip, 'Georgia', 'Atlanta')
    os.makedirs(atl)
    dt = base + timedelta(days=4)
    scene(1920, 1080, 300, 'PNG').save(os.path.join(atl, 'skyline.png'))
    scene(2400, 1600, 301, 'WEBP').save(os.path.join(atl, 'aquarium.webp'), quality=85)
    frames = [scene(480, 320, 310 + k, f'GIF frame {k}') for k in range(6)]
    frames[0].save(os.path.join(atl, 'animated.gif'), save_all=True, append_images=frames[1:], duration=200, loop=0)
    scene(3000, 2000, 320, 'TIFF').save(os.path.join(atl, 'scan.tif'), compression='tiff_lzw')
    scene(1600, 1200, 330, 'BMP 24').save(os.path.join(atl, 'old-scan.bmp'))
    write_bmp(os.path.join(atl, 'palette-8bit.bmp'), scene(800, 600, 331, 'BMP 8'), 8)
    if HAVE_HEIF:
        try:
            pillow_heif.register_avif_opener()
            scene(1600, 1000, 340, 'AVIF').save(os.path.join(atl, 'modern.avif'), quality=70)
        except Exception:
            pass
    open(os.path.join(atl, 'logo.svg'), 'w').write(
        '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">'
        '<rect width="800" height="600" fill="#1d3557"/><circle cx="400" cy="300" r="180" fill="#e63946"/>'
        '<text x="400" y="320" font-size="64" text-anchor="middle" fill="#fff" font-family="sans-serif">SVG</text></svg>')
    for f in os.listdir(atl):
        t = (dt + timedelta(minutes=random.randint(0, 600))).timestamp()
        os.utime(os.path.join(atl, f), (t, t))

    raw = os.path.join(ROOT, 'Raw Files')
    os.makedirs(raw)
    for f in ['iss030e122639.NEF', 'CanonRaw.cr2', 'DNG.dng', 'Nikon.nef']:
        src = os.path.join('/tmp/rawsamples', f)
        if os.path.exists(src):
            shutil.copy(src, os.path.join(raw, f))

    vids = os.path.join(ROOT, 'Videos')
    os.makedirs(vids)
    src = ['-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=6', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6']
    ff(*src, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-metadata', 'creation_time=2026-07-05T14:00:00Z', '-movflags', '+faststart', os.path.join(vids, 'beach-walk.mp4'))
    ff(*src, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-metadata', 'creation_time=2026-07-06T10:00:00Z', os.path.join(vids, 'boat.mov'))
    ff('-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=25:duration=5', '-c:v', 'libvpx-vp9', '-b:v', '1M', '-deadline', 'realtime', os.path.join(vids, 'clip.webm'))
    ff('-f', 'lavfi', '-i', 'mandelbrot=size=1280x720:rate=25', '-t', '5', '-c:v', 'libvpx-vp9', '-b:v', '1M', '-deadline', 'realtime', os.path.join(vids, 'fractal.mkv'))
    ff('-f', 'lavfi', '-i', 'testsrc=size=640x480:rate=25:duration=5', '-c:v', 'mpeg4', '-q:v', '5', os.path.join(vids, 'old-camera.avi'))
    ff('-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=4', '-c:v', 'libx265', '-tag:v', 'hvc1', '-pix_fmt', 'yuv420p', '-x265-params', 'log-level=error', os.path.join(vids, 'iphone-hevc.mp4'))
    ff('-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=30:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', os.path.join(vids, 'portrait-phone.mp4'))
    ff('-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=60', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=60', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', os.path.join(vids, 'one-minute.mp4'))

    broken = os.path.join(ROOT, 'Broken')
    os.makedirs(broken)
    good = open(os.path.join(beach, 'IMG_2840.JPG'), 'rb').read()
    open(os.path.join(broken, 'truncated.jpg'), 'wb').write(good[: len(good) // 3])
    open(os.path.join(broken, 'not-really.jpg'), 'wb').write(os.urandom(50000))
    open(os.path.join(broken, 'zero-ish.png'), 'wb').write(b'\x89PNG\r\n\x1a\n' + os.urandom(64))
    vid = open(os.path.join(vids, 'beach-walk.mp4'), 'rb').read()
    open(os.path.join(broken, 'cut-off.mp4'), 'wb').write(vid[: len(vid) // 5])
    open(os.path.join(broken, 'notes.txt'), 'w').write('not media')

    dups = os.path.join(ROOT, 'Duplicates')
    os.makedirs(dups)
    shutil.copy(os.path.join(beach, 'IMG_2841.JPG'), os.path.join(dups, 'IMG_2841.JPG'))
    shutil.copy(os.path.join(beach, 'IMG_2841.JPG'), os.path.join(dups, 'IMG_2841 (1).JPG'))
    im = Image.open(os.path.join(beach, 'IMG_2843.JPG'))
    im.resize((2000, 1500)).save(os.path.join(dups, 'IMG_2843-small.jpg'), quality=70)

    count = sum(len(fs) for _, _, fs in os.walk(ROOT))
    print(f'Wrote {count} files to {ROOT}')


if __name__ == '__main__':
    main()
