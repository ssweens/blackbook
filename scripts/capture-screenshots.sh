#!/bin/bash
# Captures screenshots of all 5 Blackbook tabs for documentation
# Requires: macOS with iTerm2, imagemagick (brew install imagemagick)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
ASSETS_DIR="$REPO_DIR/assets"
TUI_DIR="$REPO_DIR/tui"
TMP_DIR="/tmp/blackbook-screenshots-$$"

# Tab names in order (left to right)
TABS=("discover" "installed" "marketplaces" "tools" "sync")



echo "📸 Blackbook Screenshot Capture"
echo "================================"
echo "Assets dir: $ASSETS_DIR"

# Check for imagemagick
if ! command -v magick &> /dev/null && ! command -v convert &> /dev/null; then
    echo "❌ imagemagick required: brew install imagemagick"
    exit 1
fi

# Use magick if available, otherwise convert
CONVERT_CMD="convert"
if command -v magick &> /dev/null; then
    CONVERT_CMD="magick"
fi

# Ensure directories exist
mkdir -p "$ASSETS_DIR"
mkdir -p "$TMP_DIR"

# Build first
echo "🔨 Building..."
cd "$TUI_DIR"
pnpm build >/dev/null 2>&1

# Window size in pixels
WIN_WIDTH=1080
WIN_HEIGHT=600

# Launch blackbook in iTerm with specific window size
echo "🚀 Launching Blackbook in iTerm..."
osascript <<EOF
tell application "iTerm"
    activate
    
    -- Create new window
    create window with default profile
    
    tell current window
        -- Set window size via bounds {left, top, right, bottom}
        set bounds to {50, 50, 50 + $WIN_WIDTH, 50 + $WIN_HEIGHT}
        
        tell current session
            write text "cd '$TUI_DIR' && clear && node dist/cli.js"
        end tell
    end tell
end tell
EOF

echo "⏳ Waiting for app to load..."
sleep 5

# Get the window ID
WIN_ID=$(osascript -e 'tell application "iTerm" to return id of current window')
echo "   Window ID: $WIN_ID"

# Function to take and crop screenshot
take_screenshot() {
    local tab_name=$1
    local tmp_file="$TMP_DIR/${tab_name}-raw.png"
    local output_file="$ASSETS_DIR/${tab_name}-tab.png"
    
    # Bring iTerm to front
    osascript -e 'tell application "iTerm" to activate'
    sleep 0.3
    
    # Take screenshot of the window
    screencapture -o -l "$WIN_ID" "$tmp_file"
    
    if [[ -f "$tmp_file" ]]; then
        # Get image dimensions
        dims=$($CONVERT_CMD "$tmp_file" -format "%wx%h" info:)
        width=$(echo $dims | cut -d'x' -f1)
        height=$(echo $dims | cut -d'x' -f2)
        
        # Crop: remove only the iTerm title bar (traffic lights + tab bar)
        local crop_top=52     # Title bar only (~26px * 2 for retina)
        local crop_bottom=0
        local new_height=$((height - crop_top - crop_bottom))
        
        $CONVERT_CMD "$tmp_file" -crop "${width}x${new_height}+0+${crop_top}" +repage "$output_file"
        
        local size=$(du -h "$output_file" | cut -f1)
        echo "   ✓ ${tab_name}-tab.png ($size)"
        rm "$tmp_file"
    else
        echo "   ✗ Failed to capture $tab_name"
    fi
}

# Function to send right arrow key to switch tabs
next_tab() {
    osascript -e '
    tell application "iTerm" to activate
    delay 0.1
    tell application "System Events"
        key code 124 -- right arrow
    end tell
    '
    sleep 0.5
}

# Capture each tab
echo ""
echo "📷 Capturing tabs..."

for i in "${!TABS[@]}"; do
    tab="${TABS[$i]}"
    take_screenshot "$tab"
    
    # Move to next tab (except after last one)
    if [[ $i -lt $((${#TABS[@]} - 1)) ]]; then
        next_tab
    fi
done

# Close iTerm window
echo ""
echo "🧹 Cleaning up..."
osascript -e '
tell application "iTerm"
    tell current window
        close
    end tell
end tell
' 2>/dev/null || true

# Cleanup temp dir
rm -rf "$TMP_DIR"

echo ""
echo "✅ Screenshots saved to $ASSETS_DIR/"
ls -lh "$ASSETS_DIR"/*.png 2>/dev/null | awk '{print "   " $9 " (" $5 ")"}'
