#!/usr/bin/env python3
"""
Create unified color Blinka font where ALL pixels are positioned correctly
Use the accurate 'blanking' process for ALL colors, not just purple
Build separate base glyphs for each pixel color, then stack them
"""

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from fontTools.colorLib.builder import buildCOLR, buildCPAL
from PIL import Image
import os

def create_unified_color_blinka():
    """Create color Blinka using the accurate positioning process for ALL colors"""

    print("Creating unified color Blinka font from BMP...")
    print("Using the accurate 'blanking' coordinate system for ALL color positioning")

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
    print(f"Background color: RGB{bg_color}")

    # Define our three specific colors
    white_rgb = (255, 255, 255)
    light_blue_rgb = (166, 202, 240)

    # Separate pixels by our three colors
    white_pixels = []
    light_blue_pixels = []
    purple_pixels = []

    for y in range(original_height):
        for x in range(original_width):
            pixel = img.getpixel((x, y))
            rgb = pixel[:3]

            if rgb == bg_color:  # Skip black background
                continue
            elif rgb == white_rgb:
                white_pixels.append((x, y))
            elif rgb == light_blue_rgb:
                light_blue_pixels.append((x, y))
            else:
                # Everything else becomes purple
                purple_pixels.append((x, y))

    print(f"\nPixel analysis:")
    print(f"White pixels: {len(white_pixels)}")
    print(f"Light blue pixels: {len(light_blue_pixels)}")
    print(f"Purple pixels (all others): {len(purple_pixels)}")

    # Scale factor
    scale_factor = 4
    base_offset = 50

    # Create base font
    fb = FontBuilder(1000, isTTF=True)
    glyph_order = [".notdef", "space", "blinka", "blinka.purple_base", "blinka.lightblue_base", "blinka.white_base"]
    fb.setupGlyphOrder(glyph_order)

    def create_complete_base_glyph_for_color(all_pixels, target_pixels, color_name):
        """
        Create a base glyph using the SAME process as the working purple version,
        but only show pixels of the target color
        """
        pen = TTGlyphPen(None)

        if not target_pixels:
            return pen.glyph()  # Empty glyph if no pixels

        print(f"Creating {color_name} base glyph using accurate positioning:")
        print(f"  Total visible pixels in image: {len(all_pixels)}")
        print(f"  Target color pixels: {len(target_pixels)}")

        # Use THE EXACT SAME coordinate calculation as the working purple version
        # This is the "accurate blanking" process that positions correctly

        for x, y in target_pixels:
            # EXACT same calculation as working simple purple version
            flipped_y = (original_height - 1 - y)
            left = x * scale_factor + base_offset
            right = left + scale_factor
            bottom = flipped_y * scale_factor + 100
            top = bottom + scale_factor

            # Add rectangle using the SAME process that works for purple
            pen.moveTo((left, bottom))
            pen.lineTo((right, bottom))
            pen.lineTo((right, top))
            pen.lineTo((left, top))
            pen.closePath()

        print(f"  {color_name} positioned using working coordinate system")
        return pen.glyph()

    def create_empty_base_outline_glyph():
        """Create empty base outline - colors are in separate base glyphs"""
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

    # Get all visible pixels for reference
    all_visible = white_pixels + light_blue_pixels + purple_pixels

    # Setup glyphs - each color gets its own "base" glyph using accurate positioning
    glyphs = {
        ".notdef": create_notdef_glyph(),
        "space": create_space_glyph(),
        "blinka": create_empty_base_outline_glyph(),  # Empty - colors are in separate base glyphs
        "blinka.purple_base": create_complete_base_glyph_for_color(all_visible, purple_pixels, "purple"),
        "blinka.lightblue_base": create_complete_base_glyph_for_color(all_visible, light_blue_pixels, "lightblue"),
        "blinka.white_base": create_complete_base_glyph_for_color(all_visible, white_pixels, "white")
    }

    fb.setupGlyf(glyphs)

    # Character mapping
    cmap = {
        0x20: "space",
        0xE000: "blinka"
    }
    fb.setupCharacterMap(cmap)

    # Calculate proper metrics using the working approach
    if all_visible:
        min_x = min(x for x, y in all_visible)
        max_x = max(x for x, y in all_visible)
        glyph_width = (max_x - min_x + 2) * scale_factor + 100
    else:
        glyph_width = original_width * scale_factor + 100

    # Metrics
    metrics = {
        ".notdef": (500, 50),
        "space": (600, 0),
        "blinka": (glyph_width, 50),
        "blinka.purple_base": (glyph_width, 50),
        "blinka.lightblue_base": (glyph_width, 50),
        "blinka.white_base": (glyph_width, 50)
    }

    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader()

    # Font info
    fb.setupNameTable({
        "familyName": "FreeMono Unified Color Blinka",
        "styleName": "Regular",
        "uniqueFontIdentifier": "FreeMonoUnifiedColorBlinka-1.0",
        "fullName": "FreeMono Unified Color Blinka Regular",
        "psName": "FreeMonoUnifiedColorBlinka-Regular",
        "version": "1.0"
    })

    fb.setupOS2()
    fb.setupPost()

    # Create the font
    font = fb.font

    # Add COLR/CPAL tables - stack the base glyphs
    try:
        # Define our color palette
        purple_color = (128/255.0, 32/255.0, 192/255.0, 1.0)
        white_color = (255/255.0, 255/255.0, 255/255.0, 1.0)
        light_blue_color = (166/255.0, 202/255.0, 240/255.0, 1.0)
        palette = [purple_color, white_color, light_blue_color]

        # COLR data - stack the base glyphs (each positioned accurately)
        colr_data = {
            "blinka": [
                ("blinka.purple_base", 0),    # purple base glyph, palette index 0
                ("blinka.lightblue_base", 2), # light blue base glyph, palette index 2
                ("blinka.white_base", 1)      # white base glyph, palette index 1 (on top)
            ]
        }

        # Build COLR and CPAL tables
        colr_table = buildCOLR(colr_data)
        cpal_table = buildCPAL([palette])

        # Add to font
        font["COLR"] = colr_table
        font["CPAL"] = cpal_table

        print(f"\nAdded COLR/CPAL with unified base glyph approach:")
        print(f"  Each color uses the SAME accurate positioning as working purple")
        print(f"  Palette[0]: Purple RGB(128, 32, 192)")
        print(f"  Palette[1]: White RGB(255, 255, 255)")
        print(f"  Palette[2]: Light Blue RGB(166, 202, 240)")
        success = True

    except Exception as e:
        print(f"Could not add COLR/CPAL tables: {e}")
        success = False

    # Save the font
    output_path = "FreeMono-UnifiedColor-Blinka.ttf"
    font.save(output_path)

    print(f"\nUnified color Blinka font created: {output_path}")
    print(f"Blinka character: \\uE000")

    if success:
        print("* Unified color approach using accurate base glyph positioning")
        print("* Each color positioned using the SAME process as working purple")
        print("* Should eliminate multi-layer coordinate misalignment")
    else:
        print("* Created outline-only version")

    return True

if __name__ == "__main__":
    create_unified_color_blinka()