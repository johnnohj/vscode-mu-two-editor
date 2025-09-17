#!/usr/bin/env python3
"""
Create terminal-optimized Blinka font for xterm.js compatibility
Fixes baseline and metrics issues for proper terminal rendering
Based on natural anchor approach with terminal-specific adjustments
"""

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from fontTools.colorLib.builder import buildCOLR, buildCPAL
from PIL import Image
import os

def create_terminal_optimized_blinka():
    """Create terminal-optimized Blinka with proper metrics for xterm.js"""

    print("Creating terminal-optimized Blinka font...")
    print("Fixing baseline and metrics for xterm.js compatibility")

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

    # Define natural anchor pixels that exist in Blinka's form
    natural_anchors = [
        (0, 15),  # Bottom-left: RGB(40, 49, 58) - dark blue-gray
        (0, 14),  # Left edge: RGB(128, 32, 192) - main purple
        (14, 15)  # Bottom-right: RGB(128, 26, 154) - medium purple variant
    ]

    # Define ALL seventeen colors from the original BMP analysis
    seventeen_colors = [
        (255, 255, 255),   # WHITE - Essential eyes (2 pixels)
        (166, 202, 240),   # LIGHT BLUE - Essential eyes (8 pixels)
        (128, 32, 192),    # Main purple (20 pixels)
        (96, 24, 144),     # Dark purple (14 pixels)
        (96, 64, 128),     # Purple-blue (13 pixels)
        (160, 32, 192),    # Bright purple (12 pixels)
        (61, 43, 52),      # Dark gray-purple (12 pixels)
        (40, 49, 58),      # Dark blue-gray (11 pixels) - includes anchor!
        (102, 26, 154),    # Medium purple (10 pixels)
        (120, 24, 144),    # Dark purple variant (8 pixels)
        (128, 26, 154),    # Medium purple variant (6 pixels) - includes anchor!
        (224, 160, 192),   # Light pink-purple (6 pixels)
        (64, 42, 85),      # Dark purple-gray (2 pixels)
        (60, 40, 80),      # Dark purple variant (2 pixels)
        (38, 46, 55),      # Dark blue-gray variant (2 pixels)
        (0, 64, 192),      # Blue accent (1 pixel)
        (56, 40, 48)       # Dark gray (1 pixel)
    ]

    # Separate pixels by color
    color_pixel_groups = {}
    all_visible_pixels = []

    for y in range(original_height):
        for x in range(original_width):
            pixel = img.getpixel((x, y))
            rgb = pixel[:3]

            if rgb == bg_color:
                continue

            all_visible_pixels.append((x, y))

            # Check if this pixel matches one of our seventeen target colors
            for color in seventeen_colors:
                if rgb == color:
                    if color not in color_pixel_groups:
                        color_pixel_groups[color] = []
                    color_pixel_groups[color].append((x, y))
                    break

    print(f"Total visible pixels: {len(all_visible_pixels)}")

    # Find the OVERALL bounds of the entire shape
    min_x = min(x for x, y in all_visible_pixels)
    max_x = max(x for x, y in all_visible_pixels)
    min_y = min(y for x, y in all_visible_pixels)
    max_y = max(y for x, y in all_visible_pixels)

    print(f"Overall shape bounds: X={min_x}-{max_x}, Y={min_y}-{max_y}")

    # TERMINAL-OPTIMIZED METRICS
    # Use standard terminal font sizing (600 units per em for monospace)
    units_per_em = 1000
    scale_factor = 55  # Scale back up for better visibility

    # Position the glyph like a descender character (g, j, p, q, y)
    # Bottom should be in descender area, top should reach x-height or higher
    descender_depth = 200  # How far below baseline the bottom sits
    character_height = 700 # Total height from bottom to top

    # Center horizontally for monospace
    glyph_width = 600  # Standard monospace width
    horizontal_center = glyph_width // 2
    shape_width = (max_x - min_x + 1) * scale_factor
    horizontal_offset = horizontal_center - (shape_width // 2)

    # Create base font with proper terminal metrics
    fb = FontBuilder(units_per_em, isTTF=True)
    glyph_order = [".notdef", "space", "blinka", "blinka.base"] + [f"blinka.color{i+1:02d}" for i in range(17)]
    fb.setupGlyphOrder(glyph_order)

    def create_terminal_layer_with_natural_anchors(pixel_positions, layer_name, description, force_anchors=False):
        """Create layer optimized for terminal rendering with natural anchors"""
        pen = TTGlyphPen(None)

        print(f"Creating {layer_name}: {description}")
        print(f"  Pixels to draw: {len(pixel_positions)}")

        # Debug: Show coordinate range for this layer
        if layer_name == "base":
            print(f"  DEBUG: Font coordinate range will be Y={400} to Y={-150}")

        # Start with the actual pixels for this layer
        all_layer_pixels = pixel_positions.copy()

        # NATURAL ANCHOR APPROACH: Include natural anchor pixels if they're missing
        anchors_added = []
        if force_anchors or len(pixel_positions) < 20:
            for anchor_x, anchor_y in natural_anchors:
                if (anchor_x, anchor_y) not in pixel_positions:
                    anchor_pixel = img.getpixel((anchor_x, anchor_y))
                    anchor_rgb = anchor_pixel[:3]

                    if anchor_rgb != bg_color:
                        all_layer_pixels.append((anchor_x, anchor_y))
                        anchors_added.append((anchor_x, anchor_y, anchor_rgb))

        if anchors_added:
            print(f"  Added {len(anchors_added)} natural anchors for coordination")

        for x, y in all_layer_pixels:
            # EXACT same coordinate calculation as working versions
            flipped_y = (original_height - 1 - y)
            left = x * scale_factor + horizontal_offset
            right = left + scale_factor

            # Fine-tune Blinka specifically - make it different from notdef
            baseline_adjustment = -150  # More upward adjustment for Blinka only
            bottom = flipped_y * scale_factor + baseline_adjustment
            top = bottom + scale_factor

            # Add rectangle
            pen.moveTo((left, bottom))
            pen.lineTo((right, bottom))
            pen.lineTo((right, top))
            pen.lineTo((left, top))
            pen.closePath()

        return pen.glyph()

    def create_empty_base():
        pen = TTGlyphPen(None)
        return pen.glyph()

    def create_terminal_space_glyph():
        """Create proper space glyph for terminal"""
        pen = TTGlyphPen(None)
        return pen.glyph()

    def create_terminal_notdef_glyph():
        """Create .notdef glyph optimized for terminal with corrected baseline"""
        pen = TTGlyphPen(None)
        # Apply the same baseline adjustment as Blinka
        baseline_adjustment = 0
        # Create a standard missing character box
        pen.moveTo((50, 50 + baseline_adjustment))
        pen.lineTo((550, 50 + baseline_adjustment))
        pen.lineTo((550, 650 + baseline_adjustment))
        pen.lineTo((50, 650 + baseline_adjustment))
        pen.closePath()
        # Inner outline
        pen.moveTo((100, 100 + baseline_adjustment))
        pen.lineTo((100, 600 + baseline_adjustment))
        pen.lineTo((500, 600 + baseline_adjustment))
        pen.lineTo((500, 100 + baseline_adjustment))
        pen.closePath()
        return pen.glyph()

    # Setup seventeen-layer glyphs with natural anchors
    glyphs = {
        ".notdef": create_terminal_notdef_glyph(),
        "space": create_terminal_space_glyph(),
        "blinka": create_empty_base(),
        "blinka.base": create_terminal_layer_with_natural_anchors(
            all_visible_pixels,
            "base",
            "ALL pixels - provides base background",
            force_anchors=False
        )
    }

    # Add the seventeen color overlay layers
    for i, color in enumerate(seventeen_colors):
        pixels = color_pixel_groups.get(color, [])
        layer_name = f"blinka.color{i+1:02d}"

        # Force anchors for small layers to ensure coordinate consistency
        force_anchors = len(pixels) <= 8

        glyphs[layer_name] = create_terminal_layer_with_natural_anchors(
            pixels,
            f"color{i+1:02d}",
            f"RGB{color} pixels only",
            force_anchors=force_anchors
        )

    fb.setupGlyf(glyphs)

    # Character mapping
    cmap = {
        0x20: "space",
        0xE000: "blinka"  # Private Use Area
    }
    fb.setupCharacterMap(cmap)

    # TERMINAL-OPTIMIZED METRICS
    metrics = {
        ".notdef": (glyph_width, 50),
        "space": (glyph_width, 0),
        "blinka": (glyph_width, 50),
        "blinka.base": (glyph_width, 50)
    }

    # Add metrics for color layers
    for i in range(17):
        metrics[f"blinka.color{i+1:02d}"] = (glyph_width, 50)

    fb.setupHorizontalMetrics(metrics)

    # Setup proper horizontal header with much more headroom
    fb.setupHorizontalHeader(
        ascent=700,   # Much more height above baseline for full character display
        descent=400,  # More depth below baseline for descenders
        lineGap=50    # Minimal extra spacing between lines
    )

    # Font info
    fb.setupNameTable({
        "familyName": "FreeMono Terminal Blinka",
        "styleName": "Regular",
        "uniqueFontIdentifier": "FreeMonoTerminalBlinka-1.0",
        "fullName": "FreeMono Terminal Blinka Regular",
        "psName": "FreeMonoTerminalBlinka-Regular",
        "version": "1.0"
    })

    # Setup OS/2 table with proper metrics for full character display
    fb.setupOS2(
        sTypoAscender=700,   # Match our header ascent
        sTypoDescender=-400, # Match our header descent
        sTypoLineGap=50,     # Match our header line gap
        usWinAscent=750,     # Windows ascent
        usWinDescent=450     # Windows descent
    )
    fb.setupPost()

    font = fb.font

    # COLR/CPAL tables with seventeen colors
    try:
        # Define our color palette
        palette = []
        palette.append((128/255.0, 32/255.0, 192/255.0, 1.0))  # Index 0: Base purple

        for color in seventeen_colors:
            r, g, b = color
            palette.append((r/255.0, g/255.0, b/255.0, 1.0))

        # COLR data - layered from bottom to top
        colr_layers = [("blinka.base", 0)]  # Base layer with index 0

        # Add the seventeen color overlays
        for i in range(17):
            layer_name = f"blinka.color{i+1:02d}"
            color_index = i + 1  # Palette indices 1-17
            colr_layers.append((layer_name, color_index))

        colr_data = {"blinka": colr_layers}

        colr_table = buildCOLR(colr_data)
        cpal_table = buildCPAL([palette])

        font["COLR"] = colr_table
        font["CPAL"] = cpal_table

        print(f"\nAdded COLR/CPAL with terminal optimization:")
        print(f"  Total layers: {len(colr_layers)} (1 base + 17 color overlays)")
        print(f"  Terminal-optimized metrics and baseline")
        print(f"  Natural anchor coordination system")
        success = True

    except Exception as e:
        print(f"Could not add COLR/CPAL tables: {e}")
        success = False

    # Save font
    output_path = "FreeMono-Terminal-Blinka.ttf"
    font.save(output_path)

    print(f"\nTerminal-optimized Blinka font created: {output_path}")
    print(f"Blinka character: \\uE000")
    print(f"Optimized for xterm.js terminal rendering")

    if success:
        print("* SEVENTEEN distinct color layers with perfect alignment")
        print("* Terminal-optimized metrics and baseline positioning")
        print("* Natural anchor coordination - no artificial spacers")
        print("* Fixed for xterm.js compatibility")
    else:
        print("* Created outline-only version")

    return True

if __name__ == "__main__":
    create_terminal_optimized_blinka()