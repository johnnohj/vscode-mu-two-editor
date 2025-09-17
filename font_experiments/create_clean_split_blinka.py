#!/usr/bin/env python3
"""
Create clean split-region Blinka font without visible corner spacers
Now that we know forced bounds works, use the same coordinate system without artifacts
"""

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from fontTools.colorLib.builder import buildCOLR, buildCPAL
from PIL import Image
import os

def create_clean_split_blinka():
    """Create Blinka split into non-overlapping top/bottom regions with clean forced bounds"""

    print("Creating clean split-region Blinka font...")
    print("Top half (head/neck) vs bottom half (body/feet) - NO visible corner spacers")

    bmp_path = "assets/blinka.bmp"
    if not os.path.exists(bmp_path):
        print(f"BMP file not found: {bmp_path}")
        return False

    # Load and analyze the BMP
    img = Image.open(bmp_path)
    img = img.convert('RGBA')
    original_width, original_height = img.size

    print(f"Original BMP: {original_width}x{original_height}")

    # Get background color (black)
    bg_color = img.getpixel((0, 0))[:3]

    # Collect ALL visible pixels
    all_pixels = []
    for y in range(original_height):
        for x in range(original_width):
            pixel = img.getpixel((x, y))
            rgb = pixel[:3]
            if rgb != bg_color:
                all_pixels.append((x, y))

    print(f"Total visible pixels: {len(all_pixels)}")

    # Split into top and bottom halves
    mid_y = original_height // 2
    top_half_pixels = [(x, y) for x, y in all_pixels if y < mid_y]
    bottom_half_pixels = [(x, y) for x, y in all_pixels if y >= mid_y]

    print(f"\nRegion split:")
    print(f"Top half: {len(top_half_pixels)} pixels")
    print(f"Bottom half: {len(bottom_half_pixels)} pixels")

    # Overall bounds for coordinate system consistency
    min_x = min(x for x, y in all_pixels)
    max_x = max(x for x, y in all_pixels)
    min_y = min(y for x, y in all_pixels)
    max_y = max(y for x, y in all_pixels)

    print(f"Overall bounds: X={min_x}-{max_x}, Y={min_y}-{max_y}")

    # Scale factor
    scale_factor = 4
    base_offset = 50

    # Create base font
    fb = FontBuilder(1000, isTTF=True)
    glyph_order = [".notdef", "space", "blinka", "blinka.top_half", "blinka.bottom_half"]
    fb.setupGlyphOrder(glyph_order)

    def create_region_glyph_with_forced_bounds(pixel_positions, region_name):
        """Create glyph for a specific region with coordinate system forcing"""
        pen = TTGlyphPen(None)

        if not pixel_positions:
            return pen.glyph()

        print(f"Creating {region_name} with {len(pixel_positions)} pixels")

        # Create a complete coordinate system by considering the overall bounds
        # This ensures both layers use the same coordinate calculations
        # WITHOUT adding visible corner rectangles

        for x, y in pixel_positions:
            # EXACT same coordinate calculation as WORKING version
            flipped_y = (original_height - 1 - y)
            left = x * scale_factor + base_offset
            right = left + scale_factor
            bottom = flipped_y * scale_factor + 100
            top = bottom + scale_factor

            # Add rectangle using consistent coordinate system
            pen.moveTo((left, bottom))
            pen.lineTo((right, bottom))
            pen.lineTo((right, top))
            pen.lineTo((left, top))
            pen.closePath()

        return pen.glyph()

    def create_empty_base():
        pen = TTGlyphPen(None)
        return pen.glyph()

    def create_space_glyph():
        pen = TTGlyphPen(None)
        return pen.glyph()

    def create_notdef_glyph():
        pen = TTGlyphPen(None)
        pen.moveTo((50, 0))
        pen.lineTo((450, 0))
        pen.lineTo((450, 750))
        pen.lineTo((50, 750))
        pen.closePath()
        return pen.glyph()

    # Setup glyphs - split into non-overlapping regions
    glyphs = {
        ".notdef": create_notdef_glyph(),
        "space": create_space_glyph(),
        "blinka": create_empty_base(),
        "blinka.top_half": create_region_glyph_with_forced_bounds(top_half_pixels, "top_half"),
        "blinka.bottom_half": create_region_glyph_with_forced_bounds(bottom_half_pixels, "bottom_half")
    }

    fb.setupGlyf(glyphs)

    # Character mapping
    cmap = {
        0x20: "space",
        0xE000: "blinka"
    }
    fb.setupCharacterMap(cmap)

    # Metrics calculation using all pixels
    glyph_width = (max_x - min_x + 2) * scale_factor + 100

    metrics = {
        ".notdef": (500, 50),
        "space": (600, 0),
        "blinka": (glyph_width, 50),
        "blinka.top_half": (glyph_width, 50),
        "blinka.bottom_half": (glyph_width, 50)
    }

    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader()

    # Font info
    fb.setupNameTable({
        "familyName": "FreeMono Clean Split Blinka",
        "styleName": "Regular",
        "uniqueFontIdentifier": "FreeMonoCleanSplitBlinka-1.0",
        "fullName": "FreeMono Clean Split Blinka Regular",
        "psName": "FreeMonoCleanSplitBlinka-Regular",
        "version": "1.0"
    })

    fb.setupOS2()
    fb.setupPost()

    font = fb.font

    # COLR/CPAL tables - two non-overlapping regions
    try:
        # Define colors for the two regions
        purple_color = (128/255.0, 32/255.0, 192/255.0, 1.0)  # Top half
        blue_color = (64/255.0, 128/255.0, 255/255.0, 1.0)    # Bottom half
        palette = [purple_color, blue_color]

        # COLR data - stack the two regions
        colr_data = {
            "blinka": [
                ("blinka.bottom_half", 1),  # Blue bottom half (first/bottom layer)
                ("blinka.top_half", 0)      # Purple top half (second/top layer)
            ]
        }

        colr_table = buildCOLR(colr_data)
        cpal_table = buildCPAL([palette])

        font["COLR"] = colr_table
        font["CPAL"] = cpal_table

        print(f"\nAdded COLR/CPAL with clean split regions:")
        print(f"  Layer 0 (bottom): Blue bottom half - {len(bottom_half_pixels)} pixels")
        print(f"  Layer 1 (top): Purple top half - {len(top_half_pixels)} pixels")
        print(f"  NO corner spacers - clean alignment")
        success = True

    except Exception as e:
        print(f"Could not add COLR/CPAL tables: {e}")
        success = False

    # Save font
    output_path = "FreeMono-CleanSplit-Blinka.ttf"
    font.save(output_path)

    print(f"\nClean split Blinka font created: {output_path}")
    print(f"Blinka character: \\uE000")

    if success:
        print("* Non-overlapping top/bottom regions")
        print("* Clean alignment without visible corner artifacts")
        print("* Uses proven coordinate system from forced bounds approach")
    else:
        print("* Created outline-only version")

    return True

if __name__ == "__main__":
    create_clean_split_blinka()