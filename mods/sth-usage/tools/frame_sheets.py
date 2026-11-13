#!/usr/bin/env python3
"""Buddy's runtime frame sheets: one ordinary image file per animation.

Desktop sheets (`assets/desktop/<sequence>.webp`) are animated WebP files. Each
frame holds one still pose's exact ALPH and VP8 chunks, so `webp_frames` rebuilds
every still byte for byte; nothing is re-encoded.

Terminal sheets (`assets/terminal/<sequence>.png`) are animated PNGs of 96 x 96
8-bit RGBA poses, every row with PNG filter 0 and alpha 0 or 255. Each frame is
its own zlib stream, so the hooks module inflates one pose at a time.

`hooks/frame-sheets.ts` reads both formats the same way `webp_frames` and
`raster_frames` do here.
"""
from __future__ import annotations

import struct
import zlib

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
RASTER_SIZE = 96
WEBP_ALPHA = 0x10
WEBP_ANIMATION = 0x02
# ANMF flags: blend method "do not blend" (each pose replaces the canvas), no disposal.
WEBP_REPLACE = 0x02


def _riff_chunk(kind: bytes, payload: bytes) -> bytes:
    return kind + struct.pack("<I", len(payload)) + payload + (b"\0" if len(payload) & 1 else b"")


def _riff_chunks(data: bytes) -> list[tuple[bytes, bytes]]:
    if len(data) < 12 or data[:4] != b"RIFF" or data[8:12] != b"WEBP" or struct.unpack("<I", data[4:8])[0] != len(data) - 8:
        raise ValueError("Invalid WebP RIFF header")
    return _walk(data[12:])


def _walk(data: bytes) -> list[tuple[bytes, bytes]]:
    chunks, offset = [], 0
    while offset < len(data):
        if offset + 8 > len(data):
            raise ValueError("Truncated WebP chunk header")
        kind, size = data[offset:offset + 4], struct.unpack("<I", data[offset + 4:offset + 8])[0]
        end = offset + 8 + size
        if end > len(data):
            raise ValueError("Truncated WebP chunk")
        chunks.append((kind, data[offset + 8:end]))
        offset = end + (size & 1)
    if offset != len(data):
        raise ValueError("WebP chunk padding runs past the file")
    return chunks


def _u24(value: int) -> bytes:
    return value.to_bytes(3, "little")


def _canvas(header: bytes) -> tuple[int, int]:
    return int.from_bytes(header[4:7], "little") + 1, int.from_bytes(header[7:10], "little") + 1


def _still(width: int, height: int, frame_data: bytes) -> bytes:
    body = b"WEBP" + _riff_chunk(b"VP8X", bytes((WEBP_ALPHA, 0, 0, 0)) + _u24(width - 1) + _u24(height - 1)) + frame_data
    return b"RIFF" + struct.pack("<I", len(body)) + body


def webp_sheet(stills: list[bytes], frame_ms: int) -> bytes:
    """Wrap still poses (VP8X + ALPH + VP8) into one animated WebP, unchanged."""
    if not stills or not 0 < frame_ms < 1 << 24:
        raise ValueError("A WebP sheet needs poses and a frame duration")
    size, frames = None, []
    for index, still in enumerate(stills):
        chunks = _riff_chunks(still)
        if [kind for kind, _ in chunks] != [b"VP8X", b"ALPH", b"VP8 "] or len(chunks[0][1]) != 10 or chunks[0][1][:4] != bytes((WEBP_ALPHA, 0, 0, 0)):
            raise ValueError(f"Pose {index} is not a plain still WebP with alpha")
        canvas = _canvas(chunks[0][1])
        if size not in (None, canvas):
            raise ValueError(f"Pose {index} is {canvas[0]}x{canvas[1]}; the sheet is {size[0]}x{size[1]}")
        size = canvas
        data = b"".join(_riff_chunk(kind, payload) for kind, payload in chunks[1:])
        frames.append(_riff_chunk(b"ANMF", _u24(0) + _u24(0) + _u24(canvas[0] - 1) + _u24(canvas[1] - 1)
                                  + _u24(frame_ms) + bytes((WEBP_REPLACE,)) + data))
    width, height = size
    body = (b"WEBP" + _riff_chunk(b"VP8X", bytes((WEBP_ALPHA | WEBP_ANIMATION, 0, 0, 0)) + _u24(width - 1) + _u24(height - 1))
            + _riff_chunk(b"ANIM", bytes(4) + struct.pack("<H", 0)) + b"".join(frames))
    sheet = b"RIFF" + struct.pack("<I", len(body)) + body
    if webp_frames(sheet) != stills:
        raise ValueError("The WebP sheet does not reproduce its poses byte for byte")
    return sheet


def webp_frames(sheet: bytes) -> list[bytes]:
    """Rebuild each still pose from an animated WebP sheet, as the hooks module does."""
    chunks = _riff_chunks(sheet)
    if (len(chunks) < 3 or [kind for kind, _ in chunks[:2]] != [b"VP8X", b"ANIM"] or len(chunks[0][1]) != 10
            or chunks[0][1][0] != WEBP_ALPHA | WEBP_ANIMATION or any(kind != b"ANMF" for kind, _ in chunks[2:])):
        raise ValueError("Expected an animated WebP sheet with alpha")
    width, height = _canvas(chunks[0][1])
    stills = []
    for index, (_, payload) in enumerate(chunks[2:]):
        if (len(payload) < 16 or payload[:6] != bytes(6) or payload[6:12] != _u24(width - 1) + _u24(height - 1)
                or payload[15] != WEBP_REPLACE):
            raise ValueError(f"Sheet frame {index} must cover the whole canvas and replace it")
        frame_data = payload[16:]
        if [kind for kind, _ in _walk(frame_data)] != [b"ALPH", b"VP8 "]:
            raise ValueError(f"Sheet frame {index} must hold one ALPH and one VP8 chunk")
        stills.append(_still(width, height, frame_data))
    return stills


def _png_chunk(kind: bytes, payload: bytes) -> bytes:
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload))


def raster_sheet(frames: list[list[tuple[int, int, int] | None]], frame_ms: int) -> bytes:
    """Store 96 x 96 poses (RGB tuples, None for transparent) as an animated PNG."""
    if not frames or not 0 < frame_ms < 1 << 16:
        raise ValueError("A raster sheet needs poses and a frame duration")
    chunks = [_png_chunk(b"IHDR", struct.pack(">IIBBBBB", RASTER_SIZE, RASTER_SIZE, 8, 6, 0, 0, 0)),
              _png_chunk(b"acTL", struct.pack(">II", len(frames), 0))]
    sequence = 0
    for index, pixels in enumerate(frames):
        if len(pixels) != RASTER_SIZE * RASTER_SIZE:
            raise ValueError(f"Raster pose {index} must have {RASTER_SIZE * RASTER_SIZE} pixels")
        rows = bytearray()
        for row in range(RASTER_SIZE):
            rows.append(0)
            for color in pixels[row * RASTER_SIZE:(row + 1) * RASTER_SIZE]:
                rows.extend((0, 0, 0, 0) if color is None else (*color, 255))
        data = zlib.compress(bytes(rows), 9)
        chunks.append(_png_chunk(b"fcTL", struct.pack(">IIIIIHHBB", sequence, RASTER_SIZE, RASTER_SIZE, 0, 0, frame_ms, 1000, 0, 0)))
        sequence += 1
        if index == 0:
            chunks.append(_png_chunk(b"IDAT", data))
        else:
            chunks.append(_png_chunk(b"fdAT", struct.pack(">I", sequence) + data))
            sequence += 1
    sheet = PNG_SIGNATURE + b"".join(chunks) + _png_chunk(b"IEND", b"")
    if raster_frames(sheet) != frames:
        raise ValueError("The raster sheet does not reproduce its poses")
    return sheet


def raster_frames(sheet: bytes) -> list[list[tuple[int, int, int] | None]]:
    """Decode an animated PNG raster sheet, accepting only what raster_sheet writes."""
    if sheet[:8] != PNG_SIGNATURE:
        raise ValueError("Invalid PNG signature")
    offset, kinds, frames, count, sequence = 8, [], [], None, 0
    while offset < len(sheet):
        if offset + 12 > len(sheet):
            raise ValueError("Truncated PNG chunk")
        length = struct.unpack(">I", sheet[offset:offset + 4])[0]
        kind, payload = sheet[offset + 4:offset + 8], sheet[offset + 8:offset + 8 + length]
        if len(payload) != length or struct.unpack(">I", sheet[offset + 8 + length:offset + 12 + length])[0] != zlib.crc32(kind + payload):
            raise ValueError(f"Damaged PNG chunk: {kind!r}")
        offset += 12 + length
        kinds.append(kind)
        if kind == b"IHDR":
            if payload != struct.pack(">IIBBBBB", RASTER_SIZE, RASTER_SIZE, 8, 6, 0, 0, 0):
                raise ValueError(f"Raster sheets are {RASTER_SIZE} x {RASTER_SIZE} 8-bit RGBA")
        elif kind == b"acTL":
            count = struct.unpack(">I", payload[:4])[0]
        elif kind == b"fcTL":
            if (length != 26 or struct.unpack(">IIIII", payload[:20]) != (sequence, RASTER_SIZE, RASTER_SIZE, 0, 0)
                    or payload[24:26] != b"\0\0"):
                raise ValueError("Raster frames must cover and replace the whole canvas in order")
            sequence += 1
            frames.append(bytearray())
        elif kind in (b"IDAT", b"fdAT"):
            if not frames or (kind == b"IDAT") != (len(frames) == 1):
                raise ValueError("Raster frame data is out of order")
            if kind == b"fdAT":
                if struct.unpack(">I", payload[:4])[0] != sequence:
                    raise ValueError("Raster frame data is out of sequence")
                sequence += 1
                payload = payload[4:]
            frames[-1].extend(payload)
        elif kind != b"IEND":
            raise ValueError(f"Unexpected PNG chunk in a raster sheet: {kind!r}")
    if kinds[:2] != [b"IHDR", b"acTL"] or kinds[-1] != b"IEND" or count != len(frames) or not frames:
        raise ValueError("Raster sheets need IHDR, acTL, one frame per acTL entry and IEND")
    poses, stride = [], 1 + RASTER_SIZE * 4
    for index, data in enumerate(frames):
        raw = zlib.decompress(bytes(data))
        if len(raw) != RASTER_SIZE * stride or any(raw[row * stride] for row in range(RASTER_SIZE)):
            raise ValueError(f"Raster pose {index} must be {RASTER_SIZE} rows with filter 0")
        pixels = []
        for row in range(RASTER_SIZE):
            line = raw[row * stride + 1:(row + 1) * stride]
            for column in range(RASTER_SIZE):
                red, green, blue, alpha = line[column * 4:column * 4 + 4]
                if alpha not in (0, 255) or (alpha == 0 and (red or green or blue)):
                    raise ValueError(f"Raster pose {index} must be fully opaque or fully transparent per pixel")
                pixels.append((red, green, blue) if alpha else None)
        poses.append(pixels)
    return poses
