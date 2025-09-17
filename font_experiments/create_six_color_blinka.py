#!/usr/bin/env python3
"""
Create six-color Blinka font: adding darker purples and gray base
Step 3 in incremental color approach
Adding the next logical color groups for body variation and base
"""

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from fontTools.colorLib.builder import buildCOLR, buildCPAL
from PIL import Image
import os

def create_six_color_blinka():
    """Create six-color Blinka font - adding body variations and gray base"""

    print("Creating six-color Blinka font from BMP...")
    print("Step 3: Adding darker purples + gray base colors")

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

    # Define our six specific colors (in logical groups)
    # Eyes group
    white_rgb = (255, 255, 255)
    light_blue_rgb = (166, 202, 240)

    # Purple body group
    purple1_rgb = (128, 32, 192)   # Main purple (brightest)
    purple2_rgb = (96, 24, 144)    # Darker purple
    purple3_rgb = (160, 32, 192)   # Light purple variant

    # Base/feet group
    gray_base_rgb = (96, 64, 128)  # Main gray base color

    # Separate pixels by our six colors
    white_pixels = []
    light_blue_pixels = []
    purple1_pixels = []
    purple2_pixels = []
    purple3_pixels = []
    gray_base_pixels = []
    other_color_pixels = []

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
            elif rgb == purple1_rgb:
                purple1_pixels.append((x, y))
            elif rgb == purple2_rgb:
                purple2_pixels.append((x, y))
            elif rgb == purple3_rgb:
                purple3_pixels.append((x, y))
            elif rgb == gray_base_rgb:
                gray_base_pixels.append((x, y))
            else:
                # Everything else goes to purple1 for now
                purple1_pixels.append((x, y))
                other_color_pixels.append((x, y, rgb))

    print(f"\nPixel analysis:")
    print(f"White pixels (eye highlights): {len(white_pixels)}")
    print(f"Light blue pixels (main eyes): {len(light_blue_pixels)}")
    print(f"Purple1 pixels (main body): {len(purple1_pixels)}")
    print(f"Purple2 pixels (dark purple): {len(purple2_pixels)}")
    print(f"Purple3 pixels (light purple): {len(purple3_pixels)}")
    print(f"Gray base pixels (feet/base): {len(gray_base_pixels)}")

    total_pixels = len(white_pixels) + len(light_blue_pixels) + len(purple1_pixels) + len(purple2_pixels) + len(purple3_pixels) + len(gray_base_pixels)
    print(f"Total visible pixels: {total_pixels}")

    if other_color_pixels:
        unique_colors = len(set(rgb for _, _, rgb in other_color_pixels))
        print(f"Note: {unique_colors} other colors assigned to purple1")
        remaining_colors = set(rgb for _, _, rgb in other_color_pixels)
        print("Remaining colors for next iteration:")
        for color in sorted(remaining_colors):
            count = len([p for p in other_color_pixels if p[2] == color])
            print(f"  RGB{color}: {count} pixels")

    # Scale factor for better visibility
    scale_factor = 4
    scaled_width = original_width * scale_factor
    scaled_height = original_height * scale_factor

    # Create base font
    fb = FontBuilder(1000, isTTF=True)
    glyph_order = [".notdef", "space", "blinka",
                   "blinka.purple1", "blinka.purple2", "blinka.purple3",
                   "blinka.graybase", "blinka.lightblue", "blinka.white"]
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

        all_visible = (white_pixels + light_blue_pixels + purple1_pixels +
                      purple2_pixels + purple3_pixels + gray_base_pixels)
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
        "blinka.purple1": create_color_layer_glyph(purple1_pixels, "purple1"),
        "blinka.purple2": create_color_layer_glyph(purple2_pixels, "purple2"),
        "blinka.purple3": create_color_layer_glyph(purple3_pixels, "purple3"),
        "blinka.graybase": create_color_layer_glyph(gray_base_pixels, "graybase"),
        "blinka.lightblue": create_color_layer_glyph(light_blue_pixels, "lightblue"),
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
    all_visible = (white_pixels + light_blue_pixels + purple1_pixels +
                  purple2_pixels + purple3_pixels + gray_base_pixels)
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
        "blinka": (glyph_width, 50),
        "blinka.purple1": (glyph_width, 50),
        "blinka.purple2": (glyph_width, 50),
        "blinka.purple3": (glyph_width, 50),
        "blinka.graybase": (glyph_width, 50),
        "blinka.lightblue": (glyph_width, 50),
        "blinka.white": (glyph_width, 50)
    }

    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader()

    # Font info
    fb.setupNameTable({
        "familyName": "FreeMono Six Color Blinka",
        "styleName": "Regular",
        "uniqueFontIdentifier": "FreeMonoSixColorBlinka-1.0",
        "fullName": "FreeMono Six Color Blinka Regular",
        "psName": "FreeMonoSixColorBlinka-Regular",
        "version": "1.0"
    })

    fb.setupOS2()
    fb.setupPost()

    # Create the font
    font = fb.font

    # Add COLR/CPAL tables for six colors
    try:
        # Define our color palette (normalized to 0-1)
        purple1_color = (128/255.0, 32/255.0, 192/255.0, 1.0)  # Main purple
        purple2_color = (96/255.0, 24/255.0, 144/255.0, 1.0)   # Dark purple
        purple3_color = (160/255.0, 32/255.0, 192/255.0, 1.0)  # Light purple
        gray_base_color = (96/255.0, 64/255.0, 128/255.0, 1.0) # Gray base
        light_blue_color = (166/255.0, 202/255.0, 240/255.0, 1.0) # Eyes
        white_color = (255/255.0, 255/255.0, 255/255.0, 1.0)   # Eye highlights

        palette = [purple1_color, purple2_color, purple3_color, gray_base_color, light_blue_color, white_color]

        # COLR data - blinka uses six layers
        # Stacking order: base colors first, then details on top
        colr_data = {
            "blinka": [
                ("blinka.graybase", 3),   # Gray base (bottom layer)
                ("blinka.purple1", 0),    # Main purple body
                ("blinka.purple2", 1),    # Dark purple details
                ("blinka.purple3", 2),    # Light purple highlights
                ("blinka.lightblue", 4),  # Blue eyes
                ("blinka.white", 5)       # White eye highlights (top)
            ]
        }

        # Build COLR and CPAL tables
        colr_table = buildCOLR(colr_data)
        cpal_table = buildCPAL([palette])

        # Add to font
        font["COLR"] = colr_table
        font["CPAL"] = cpal_table

        print(f"\nAdded COLR/CPAL with six colors:")
        print(f"  Palette[0]: Purple1 RGB(128, 32, 192) - main body")
        print(f"  Palette[1]: Purple2 RGB(96, 24, 144) - dark details")
        print(f"  Palette[2]: Purple3 RGB(160, 32, 192) - light highlights")
        print(f"  Palette[3]: Gray Base RGB(96, 64, 128) - feet/base")
        print(f"  Palette[4]: Light Blue RGB(166, 202, 240) - eyes")
        print(f"  Palette[5]: White RGB(255, 255, 255) - eye highlights")
        success = True

    except Exception as e:
        print(f"Could not add COLR/CPAL tables: {e}")
        success = False

    # Save the font
    output_path = "FreeMono-SixColor-Blinka.ttf"
    font.save(output_path)

    print(f"\nSix-color Blinka font created: {output_path}")
    print(f"Blinka character: \\uE000")

    if success:
        print("* Six-color COLR/CPAL implementation")
        print("* Purple body variations + gray base + colored eyes")
        print("* Layer stacking: gray base -> purples -> eyes -> highlights")
        print("* Approaching original color complexity")
    else:
        print("* Created outline-only version")

    return True

def test_six_color_font():
    """Test the six-color font"""
    output_path = "FreeMono-SixColor-Blinka.ttf"

    if not os.path.exists(output_path):
        print("Six-color font file not found for testing")
        return False

    try:
        font = TTFont(output_path)
        has_colr = 'COLR' in font
        has_cpal = 'CPAL' in font

        print(f"\nSix-color font analysis:")
        print(f"COLR table present: {has_colr}")
        print(f"CPAL table present: {has_cpal}")

        if has_colr and has_cpal:
            print("* Six-color COLR/CPAL support detected")

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
        print(f"Six-color font testing failed: {e}")
        return False

if __name__ == "__main__":
    if create_six_color_blinka():
        test_six_color_font()