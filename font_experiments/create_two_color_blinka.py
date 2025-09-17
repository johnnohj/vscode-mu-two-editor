#!/usr/bin/env python3
"""
Create two-color Blinka font: purple body + white eyes
Incremental approach to multi-color support
Building on our working purple version
"""

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from fontTools.colorLib.builder import buildCOLR, buildCPAL
from PIL import Image
import os

def create_two_color_blinka():
    """Create two-color Blinka font - purple body with white eyes"""

    print("Creating two-color Blinka font from BMP...")
    print("Step 1: Purple body + White eyes")

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

    # Define our two colors
    white_rgb = (255, 255, 255)
    purple_rgb = (128, 32, 192)  # Primary purple we've been using

    # Separate pixels by color
    white_pixels = []
    purple_pixels = []
    other_color_pixels = []

    for y in range(original_height):
        for x in range(original_width):
            pixel = img.getpixel((x, y))
            rgb = pixel[:3]

            if rgb == bg_color:  # Skip black background
                continue
            elif rgb == white_rgb:
                white_pixels.append((x, y))
            else:
                # For now, treat ALL non-white, non-black as purple
                purple_pixels.append((x, y))
                if rgb != purple_rgb:
                    other_color_pixels.append((x, y, rgb))

    print(f"\nPixel analysis:")
    print(f"White pixels: {len(white_pixels)}")
    print(f"Purple pixels (all non-white): {len(purple_pixels)}")
    print(f"Total visible pixels: {len(white_pixels) + len(purple_pixels)}")

    if other_color_pixels:
        unique_colors = len(set(rgb for _, _, rgb in other_color_pixels))
        print(f"Note: {unique_colors} other colors will be shown as purple for now")

    # Scale factor for better visibility
    scale_factor = 4
    scaled_width = original_width * scale_factor
    scaled_height = original_height * scale_factor

    # Create base font
    fb = FontBuilder(1000, isTTF=True)
    glyph_order = [".notdef", "space", "blinka", "blinka.purple", "blinka.white"]
    fb.setupGlyphOrder(glyph_order)

    def create_color_layer_glyph(pixel_positions, color_name):
        """Create a layer glyph for specific pixels"""
        pen = TTGlyphPen(None)

        if not pixel_positions:
            return pen.glyph()  # Empty glyph if no pixels

        for x, y in pixel_positions:
            # Y-axis flip for correct orientation
            flipped_y = (original_height - 1 - y)

            # Calculate scaled coordinates
            left = x * scale_factor + 50
            right = left + scale_factor
            bottom = flipped_y * scale_factor + 100
            top = bottom + scale_factor

            # Add rectangle
            pen.moveTo((left, bottom))
            pen.lineTo((right, bottom))
            pen.lineTo((right, top))
            pen.lineTo((left, top))
            pen.closePath()

        return pen.glyph()

    def create_base_outline_glyph():
        """Create base outline from all visible pixels"""
        pen = TTGlyphPen(None)

        all_visible = white_pixels + purple_pixels
        if not all_visible:
            # Fallback rectangle
            pen.moveTo((50, 100))
            pen.lineTo((50 + scaled_width, 100))
            pen.lineTo((50 + scaled_width, 100 + scaled_height))
            pen.lineTo((50, 100 + scaled_height))
            pen.closePath()
            return pen.glyph()

        # Find actual bounds (with Y-flip)
        min_x = min(x for x, y in all_visible)
        max_x = max(x for x, y in all_visible)
        min_y = min(original_height - 1 - y for x, y in all_visible)
        max_y = max(original_height - 1 - y for x, y in all_visible)

        # Scale to font coordinates
        left = min_x * scale_factor + 50
        right = (max_x + 1) * scale_factor + 50
        bottom = min_y * scale_factor + 100
        top = (max_y + 1) * scale_factor + 100

        # Create tight bounding rectangle
        pen.moveTo((left, bottom))
        pen.lineTo((right, bottom))
        pen.lineTo((right, top))
        pen.lineTo((left, top))
        pen.closePath()

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

    # Setup glyphs
    glyphs = {
        ".notdef": create_notdef_glyph(),
        "space": create_space_glyph(),
        "blinka": create_base_outline_glyph(),
        "blinka.purple": create_color_layer_glyph(purple_pixels, "purple"),
        "blinka.white": create_color_layer_glyph(white_pixels, "white")
    }

    fb.setupGlyf(glyphs)

    # Character mapping
    cmap = {
        0x20: "space",
        0xE000: "blinka"
    }
    fb.setupCharacterMap(cmap)

    # Calculate proper metrics
    all_visible = white_pixels + purple_pixels
    if all_visible:
        min_x = min(x for x, y in all_visible)
        max_x = max(x for x, y in all_visible)
        glyph_width = (max_x - min_x + 2) * scale_factor + 100
    else:
        glyph_width = scaled_width + 100

    # Metrics
    metrics = {
        ".notdef": (500, 50),
        "space": (600, 0),
        "blinka": (glyph_width, 50),
        "blinka.purple": (glyph_width, 50),
        "blinka.white": (glyph_width, 50)
    }

    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader()

    # Font info
    fb.setupNameTable({
        "familyName": "FreeMono Two Color Blinka",
        "styleName": "Regular",
        "uniqueFontIdentifier": "FreeMonoTwoColorBlinka-1.0",
        "fullName": "FreeMono Two Color Blinka Regular",
        "psName": "FreeMonoTwoColorBlinka-Regular",
        "version": "1.0"
    })

    fb.setupOS2()
    fb.setupPost()

    # Create the font
    font = fb.font

    # Add COLR/CPAL tables for two colors
    try:
        # Define our color palette (normalized to 0-1)
        purple_color = (128/255.0, 32/255.0, 192/255.0, 1.0)
        white_color = (255/255.0, 255/255.0, 255/255.0, 1.0)
        palette = [purple_color, white_color]

        # COLR data - blinka uses two layers
        # IMPORTANT: Layers are drawn in order, so put purple first, then white on top
        colr_data = {
            "blinka": [
                ("blinka.purple", 0),  # purple layer, palette index 0
                ("blinka.white", 1)    # white layer, palette index 1
            ]
        }

        # Build COLR and CPAL tables
        colr_table = buildCOLR(colr_data)
        cpal_table = buildCPAL([palette])

        # Add to font
        font["COLR"] = colr_table
        font["CPAL"] = cpal_table

        print(f"\nAdded COLR/CPAL with two colors:")
        print(f"  Palette[0]: Purple RGB(128, 32, 192)")
        print(f"  Palette[1]: White RGB(255, 255, 255)")
        success = True

    except Exception as e:
        print(f"Could not add COLR/CPAL tables: {e}")
        success = False

    # Save the font
    output_path = "FreeMono-TwoColor-Blinka.ttf"
    font.save(output_path)

    print(f"\nTwo-color Blinka font created: {output_path}")
    print(f"Blinka character: \\uE000")

    if success:
        print("* Two-color COLR/CPAL implementation")
        print("* Purple body with white eyes")
        print("* Non-overlapping layers")
        print("* Ready for testing before adding more colors")
    else:
        print("* Created outline-only version")

    return True

def test_two_color_font():
    """Test the two-color font"""
    output_path = "FreeMono-TwoColor-Blinka.ttf"

    if not os.path.exists(output_path):
        print("Two-color font file not found for testing")
        return False

    try:
        font = TTFont(output_path)
        has_colr = 'COLR' in font
        has_cpal = 'CPAL' in font

        print(f"\nTwo-color font analysis:")
        print(f"COLR table present: {has_colr}")
        print(f"CPAL table present: {has_cpal}")

        if has_colr and has_cpal:
            print("* Two-color COLR/CPAL support detected")

            # Check layer structure
            colr_table = font['COLR']
            if hasattr(colr_table, 'ColorLayers'):
                blinka_layers = colr_table.ColorLayers.get('blinka', [])
                print(f"Blinka layers: {len(blinka_layers)}")
                for i, layer in enumerate(blinka_layers):
                    print(f"  Layer {i}: {layer.name}, palette index {layer.colorID}")

            return True
        else:
            print("* No color tables found")
            return False

    except Exception as e:
        print(f"Two-color font testing failed: {e}")
        return False

if __name__ == "__main__":
    if create_two_color_blinka():
        test_two_color_font()