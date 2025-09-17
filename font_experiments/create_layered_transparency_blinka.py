#!/usr/bin/env python3
"""
Create layered transparency Blinka font using strategic pixel on/off
Each layer covers the full shape but only shows specific color pixels
Lower layers show through higher layers via transparency
"""

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from fontTools.colorLib.builder import buildCOLR, buildCPAL
from PIL import Image
import os

def create_layered_transparency_blinka():
    """Create color Blinka using strategic transparency layering"""

    print("Creating layered transparency Blinka font from BMP...")
    print("Each layer shows only specific pixels, letting lower layers show through")

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

    # Collect ALL visible pixels with their colors
    all_pixels = []
    for y in range(original_height):
        for x in range(original_width):
            pixel = img.getpixel((x, y))
            rgb = pixel[:3]
            if rgb != bg_color:  # Skip black background
                all_pixels.append((x, y, rgb))

    print(f"Total visible pixels: {len(all_pixels)}")

    # Categorize pixels by target color
    white_pixels = [(x, y) for x, y, rgb in all_pixels if rgb == white_rgb]
    light_blue_pixels = [(x, y) for x, y, rgb in all_pixels if rgb == light_blue_rgb]
    purple_pixels = [(x, y) for x, y, rgb in all_pixels if rgb != white_rgb and rgb != light_blue_rgb]

    print(f"\nLayering strategy:")
    print(f"Purple layer (bottom): ALL {len(all_pixels)} pixels -> purple base")
    print(f"Light blue layer (middle): Only {len(light_blue_pixels)} specific pixels -> blue shows through")
    print(f"White layer (top): Only {len(white_pixels)} specific pixels -> white shows through")

    # Scale factor
    scale_factor = 4
    base_offset = 50

    # Create base font
    fb = FontBuilder(1000, isTTF=True)
    glyph_order = [".notdef", "space", "blinka", "blinka.purple_base", "blinka.lightblue_overlay", "blinka.white_overlay"]
    fb.setupGlyphOrder(glyph_order)

    def create_selective_layer_glyph(pixel_positions, layer_name, description):
        """Create a layer that only shows specific pixels"""
        pen = TTGlyphPen(None)

        if not pixel_positions:
            return pen.glyph()  # Empty glyph if no pixels

        print(f"Creating {layer_name} with {len(pixel_positions)} pixels:")
        print(f"  {description}")

        for x, y in pixel_positions:
            # EXACT same coordinate calculation as working versions
            flipped_y = (original_height - 1 - y)
            left = x * scale_factor + base_offset
            right = left + scale_factor
            bottom = flipped_y * scale_factor + 100
            top = bottom + scale_factor

            # Add rectangle for this pixel
            pen.moveTo((left, bottom))
            pen.lineTo((right, bottom))
            pen.lineTo((right, top))
            pen.lineTo((left, top))
            pen.closePath()

        return pen.glyph()

    def create_empty_base_outline_glyph():
        """Create empty base outline"""
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

    # Setup glyphs using layered transparency approach
    all_pixel_positions = [(x, y) for x, y, rgb in all_pixels]

    glyphs = {
        ".notdef": create_notdef_glyph(),
        "space": create_space_glyph(),
        "blinka": create_empty_base_outline_glyph(),
        "blinka.purple_base": create_selective_layer_glyph(
            all_pixel_positions,
            "purple_base",
            "ALL pixels - provides purple background/base"
        ),
        "blinka.lightblue_overlay": create_selective_layer_glyph(
            light_blue_pixels,
            "lightblue_overlay",
            "Only light blue pixels - shows through purple base"
        ),
        "blinka.white_overlay": create_selective_layer_glyph(
            white_pixels,
            "white_overlay",
            "Only white pixels - shows through both layers below"
        )
    }

    fb.setupGlyf(glyphs)

    # Character mapping
    cmap = {
        0x20: "space",
        0xE000: "blinka"
    }
    fb.setupCharacterMap(cmap)

    # Calculate proper metrics
    if all_pixels:
        min_x = min(x for x, y, rgb in all_pixels)
        max_x = max(x for x, y, rgb in all_pixels)
        glyph_width = (max_x - min_x + 2) * scale_factor + 100
    else:
        glyph_width = original_width * scale_factor + 100

    # Metrics
    metrics = {
        ".notdef": (500, 50),
        "space": (600, 0),
        "blinka": (glyph_width, 50),
        "blinka.purple_base": (glyph_width, 50),
        "blinka.lightblue_overlay": (glyph_width, 50),
        "blinka.white_overlay": (glyph_width, 50)
    }

    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader()

    # Font info
    fb.setupNameTable({
        "familyName": "FreeMono Layered Transparency Blinka",
        "styleName": "Regular",
        "uniqueFontIdentifier": "FreeMonoLayeredTransparencyBlinka-1.0",
        "fullName": "FreeMono Layered Transparency Blinka Regular",
        "psName": "FreeMonoLayeredTransparencyBlinka-Regular",
        "version": "1.0"
    })

    fb.setupOS2()
    fb.setupPost()

    # Create the font
    font = fb.font

    # Add COLR/CPAL tables with layered transparency approach
    try:
        # Define our color palette
        purple_color = (128/255.0, 32/255.0, 192/255.0, 1.0)
        white_color = (255/255.0, 255/255.0, 255/255.0, 1.0)
        light_blue_color = (166/255.0, 202/255.0, 240/255.0, 1.0)
        palette = [purple_color, white_color, light_blue_color]

        # COLR data - layered transparency approach
        # Bottom to top: purple base → light blue overlay → white overlay
        colr_data = {
            "blinka": [
                ("blinka.purple_base", 0),        # purple layer (bottom) - ALL pixels
                ("blinka.lightblue_overlay", 2),  # light blue layer (middle) - specific pixels
                ("blinka.white_overlay", 1)       # white layer (top) - specific pixels
            ]
        }

        # Build COLR and CPAL tables
        colr_table = buildCOLR(colr_data)
        cpal_table = buildCPAL([palette])

        # Add to font
        font["COLR"] = colr_table
        font["CPAL"] = cpal_table

        print(f"\nAdded COLR/CPAL with layered transparency:")
        print(f"  Layer 0 (bottom): Purple base - all {len(all_pixels)} pixels")
        print(f"  Layer 1 (middle): Light blue overlay - {len(light_blue_pixels)} specific pixels")
        print(f"  Layer 2 (top): White overlay - {len(white_pixels)} specific pixels")
        print(f"  Higher layers show through lower layers selectively")
        success = True

    except Exception as e:
        print(f"Could not add COLR/CPAL tables: {e}")
        success = False

    # Save the font
    output_path = "FreeMono-LayeredTransparency-Blinka.ttf"
    font.save(output_path)

    print(f"\nLayered transparency Blinka font created: {output_path}")
    print(f"Blinka character: \\uE000")

    if success:
        print("* Layered transparency approach with strategic pixel on/off")
        print("* All layers use same coordinate system (no alignment issues)")
        print("* Colors show through via selective transparency")
        print("* Should produce perfect color positioning")
    else:
        print("* Created outline-only version")

    return True

if __name__ == "__main__":
    create_layered_transparency_blinka()