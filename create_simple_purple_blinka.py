#!/usr/bin/env python3
"""
Create simple purple Blinka font from BMP
Treats black as transparent, colors everything else purple
Back to basics - get the shape right first
"""

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from fontTools.colorLib.builder import buildCOLR, buildCPAL
from PIL import Image
import os

def create_simple_purple_blinka():
    """Create simple purple Blinka font - shape accuracy first"""

    print("Creating simple purple Blinka font from BMP...")

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

    # Find all non-background pixels (any non-black pixel)
    visible_pixels = []
    for y in range(original_height):
        for x in range(original_width):
            pixel = img.getpixel((x, y))
            rgb = pixel[:3]
            if rgb != bg_color:  # Not black = visible
                visible_pixels.append((x, y))

    print(f"Visible pixels (non-black): {len(visible_pixels)}")

    # Scale factor for better visibility
    scale_factor = 4
    scaled_width = original_width * scale_factor
    scaled_height = original_height * scale_factor

    # Create base font
    fb = FontBuilder(1000, isTTF=True)
    glyph_order = [".notdef", "space", "blinka", "blinka.purple"]
    fb.setupGlyphOrder(glyph_order)

    def create_purple_layer_glyph():
        """Create a single purple layer for all visible pixels"""
        pen = TTGlyphPen(None)

        # Create rectangles for each visible pixel
        for x, y in visible_pixels:
            # Calculate scaled coordinates with Y-axis flip
            # BMP Y=0 is top, but font Y=0 is bottom, so flip it
            flipped_y = (original_height - 1 - y)

            left = x * scale_factor + 50
            right = left + scale_factor
            bottom = flipped_y * scale_factor + 100
            top = bottom + scale_factor

            # Add rectangle (as a simple path)
            pen.moveTo((left, bottom))
            pen.lineTo((right, bottom))
            pen.lineTo((right, top))
            pen.lineTo((left, top))
            pen.closePath()

        return pen.glyph()

    def create_base_outline_glyph():
        """Create base outline that matches visible area exactly"""
        pen = TTGlyphPen(None)

        if not visible_pixels:
            # Fallback if no visible pixels
            pen.moveTo((50, 100))
            pen.lineTo((50 + scaled_width, 100))
            pen.lineTo((50 + scaled_width, 100 + scaled_height))
            pen.lineTo((50, 100 + scaled_height))
            pen.closePath()
            return pen.glyph()

        # Find actual bounds of visible pixels (with Y-axis flip)
        min_x = min(x for x, y in visible_pixels)
        max_x = max(x for x, y in visible_pixels)
        min_y = min(original_height - 1 - y for x, y in visible_pixels)
        max_y = max(original_height - 1 - y for x, y in visible_pixels)

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
        "blinka.purple": create_purple_layer_glyph()
    }

    fb.setupGlyf(glyphs)

    # Character mapping
    cmap = {
        0x20: "space",
        0xE000: "blinka"
    }
    fb.setupCharacterMap(cmap)

    # Calculate proper metrics based on actual visible bounds
    if visible_pixels:
        min_x = min(x for x, y in visible_pixels)
        max_x = max(x for x, y in visible_pixels)
        glyph_width = (max_x - min_x + 2) * scale_factor + 100  # Add some padding
    else:
        glyph_width = scaled_width + 100

    # Metrics
    metrics = {
        ".notdef": (500, 50),
        "space": (600, 0),
        "blinka": (glyph_width, 50),
        "blinka.purple": (glyph_width, 50)
    }

    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader()

    # Font info
    fb.setupNameTable({
        "familyName": "FreeMono Simple Blinka",
        "styleName": "Regular",
        "uniqueFontIdentifier": "FreeMonoSimpleBlinka-1.0",
        "fullName": "FreeMono Simple Blinka Regular",
        "psName": "FreeMonoSimpleBlinka-Regular",
        "version": "1.0"
    })

    fb.setupOS2()
    fb.setupPost()

    # Create the font
    font = fb.font

    # Add COLR/CPAL tables for purple color
    try:
        # Simple purple color (RGB 128, 32, 192 normalized)
        purple_color = (128/255.0, 32/255.0, 192/255.0, 1.0)
        palette = [purple_color]

        # COLR data - blinka glyph uses purple layer
        colr_data = {
            "blinka": [("blinka.purple", 0)]  # glyph name, palette index
        }

        # Build COLR and CPAL tables
        colr_table = buildCOLR(colr_data)
        cpal_table = buildCPAL([palette])

        # Add to font
        font["COLR"] = colr_table
        font["CPAL"] = cpal_table

        print(f"Added COLR/CPAL with simple purple color")
        success = True

    except Exception as e:
        print(f"Could not add COLR/CPAL tables: {e}")
        success = False

    # Save the font
    output_path = "FreeMono-Simple-Blinka.ttf"
    font.save(output_path)

    print(f"\nSimple purple Blinka font created: {output_path}")
    print(f"Blinka character: \\uE000")
    print(f"Visible pixels preserved: {len(visible_pixels)}")

    if success:
        print("* Purple COLR/CPAL color applied to all visible pixels")
        print("* Black background treated as transparent")
        print("* Tight bounding box for accurate shape")
    else:
        print("* Created outline-only version")

    return True

def test_simple_font():
    """Test the simple purple font"""
    output_path = "FreeMono-Simple-Blinka.ttf"

    if not os.path.exists(output_path):
        print("Simple font file not found for testing")
        return False

    try:
        font = TTFont(output_path)
        has_colr = 'COLR' in font
        has_cpal = 'CPAL' in font

        print(f"\nSimple font analysis:")
        print(f"COLR table present: {has_colr}")
        print(f"CPAL table present: {has_cpal}")

        if has_colr and has_cpal:
            print("* Simple purple COLR/CPAL support detected")
            return True
        else:
            print("* No color tables found")
            return False

    except Exception as e:
        print(f"Simple font testing failed: {e}")
        return False

if __name__ == "__main__":
    if create_simple_purple_blinka():
        test_simple_font()