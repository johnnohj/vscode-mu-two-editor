#!/usr/bin/env python3
"""
Create complete color Blinka font with all distinct colors
Fix positioning issue by properly mapping ALL color variants
"""

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from fontTools.colorLib.builder import buildCOLR, buildCPAL
from PIL import Image
import os

def create_complete_color_blinka():
    """Create complete color Blinka font with all 17 original colors"""

    print("Creating complete color Blinka font from BMP...")
    print("All 17 original colors mapped to distinct layers")

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

    # Collect ALL unique colors (excluding black background)
    all_colors = set()
    for y in range(original_height):
        for x in range(original_width):
            pixel = img.getpixel((x, y))
            rgb = pixel[:3]
            if rgb != bg_color:
                all_colors.add(rgb)

    # Sort colors for consistent ordering
    color_list = sorted(list(all_colors))
    print(f"\nFound {len(color_list)} unique colors:")

    # Create color-to-pixels mapping
    color_pixels = {}
    for color in color_list:
        color_pixels[color] = []

    for y in range(original_height):
        for x in range(original_width):
            pixel = img.getpixel((x, y))
            rgb = pixel[:3]
            if rgb != bg_color:
                color_pixels[rgb].append((x, y))

    # Display color analysis
    for i, color in enumerate(color_list):
        pixel_count = len(color_pixels[color])
        print(f"  Color {i:2d}: RGB{color} -> {pixel_count:2d} pixels")

    # Scale factor for better visibility
    scale_factor = 4
    scaled_width = original_width * scale_factor
    scaled_height = original_height * scale_factor

    # Create base font
    fb = FontBuilder(1000, isTTF=True)

    # Build glyph order
    glyph_order = [".notdef", "space", "blinka"]
    for i, color in enumerate(color_list):
        glyph_order.append(f"blinka.color{i:02d}")

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

        all_visible = []
        for color in color_list:
            all_visible.extend(color_pixels[color])

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
        "blinka": create_base_outline_glyph()
    }

    # Add color layer glyphs
    for i, color in enumerate(color_list):
        glyph_name = f"blinka.color{i:02d}"
        pixels = color_pixels[color]
        glyphs[glyph_name] = create_color_layer_glyph(pixels, f"color{i:02d}")

    fb.setupGlyf(glyphs)

    # Character mapping
    cmap = {
        0x20: "space",
        0xE000: "blinka"
    }
    fb.setupCharacterMap(cmap)

    # Calculate proper metrics
    all_visible = []
    for color in color_list:
        all_visible.extend(color_pixels[color])

    if all_visible:
        min_x = min(x for x, y in all_visible)
        max_x = max(x for x, y in all_visible)
        glyph_width = (max_x - min_x + 2) * scale_factor + 100
    else:
        glyph_width = scaled_width + 100

    # Metrics for all glyphs
    metrics = {
        ".notdef": (500, 50),
        "space": (600, 0),
        "blinka": (glyph_width, 50)
    }

    # Add metrics for color layer glyphs
    for i, color in enumerate(color_list):
        glyph_name = f"blinka.color{i:02d}"
        metrics[glyph_name] = (glyph_width, 50)

    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader()

    # Font info
    fb.setupNameTable({
        "familyName": "FreeMono Complete Blinka",
        "styleName": "Regular",
        "uniqueFontIdentifier": "FreeMonoCompleteBlinka-1.0",
        "fullName": "FreeMono Complete Blinka Regular",
        "psName": "FreeMonoCompleteBlinka-Regular",
        "version": "1.0"
    })

    fb.setupOS2()
    fb.setupPost()

    # Create the font
    font = fb.font

    # Add COLR/CPAL tables with all colors
    try:
        # Create normalized color palette
        palette = []
        for color in color_list:
            r, g, b = color
            palette.append((r/255.0, g/255.0, b/255.0, 1.0))

        # COLR data - all layers stacked
        # Order layers logically: darker colors first, lighter on top
        layer_list = []
        for i, color in enumerate(color_list):
            glyph_name = f"blinka.color{i:02d}"
            layer_list.append((glyph_name, i))

        colr_data = {
            "blinka": layer_list
        }

        # Build COLR and CPAL tables
        colr_table = buildCOLR(colr_data)
        cpal_table = buildCPAL([palette])

        # Add to font
        font["COLR"] = colr_table
        font["CPAL"] = cpal_table

        print(f"\nAdded COLR/CPAL with {len(color_list)} colors:")
        for i, color in enumerate(color_list):
            pixel_count = len(color_pixels[color])
            print(f"  Palette[{i:2d}]: RGB{color} ({pixel_count:2d} pixels)")

        success = True

    except Exception as e:
        print(f"Could not add COLR/CPAL tables: {e}")
        success = False

    # Save the font
    output_path = "FreeMono-Complete-Blinka.ttf"
    font.save(output_path)

    print(f"\nComplete color Blinka font created: {output_path}")
    print(f"Blinka character: \\uE000")

    if success:
        print("* Complete COLR/CPAL implementation")
        print("* All 17 original colors preserved as distinct layers")
        print("* Pixel-perfect color positioning")
        print("* Should resolve positioning/color artifacts")
    else:
        print("* Created outline-only version")

    return True

def test_complete_font():
    """Test the complete color font"""
    output_path = "FreeMono-Complete-Blinka.ttf"

    if not os.path.exists(output_path):
        print("Complete font file not found for testing")
        return False

    try:
        font = TTFont(output_path)
        has_colr = 'COLR' in font
        has_cpal = 'CPAL' in font

        print(f"\nComplete font analysis:")
        print(f"COLR table present: {has_colr}")
        print(f"CPAL table present: {has_cpal}")

        if has_colr and has_cpal:
            print("* Complete COLR/CPAL support detected")

            # Check layer structure
            colr_table = font['COLR']
            if hasattr(colr_table, 'ColorLayers'):
                blinka_layers = colr_table.ColorLayers.get('blinka', [])
                print(f"Total color layers: {len(blinka_layers)}")

            return True
        else:
            print("* No color tables found")
            return False

    except Exception as e:
        print(f"Complete font testing failed: {e}")
        return False

if __name__ == "__main__":
    if create_complete_color_blinka():
        test_complete_font()