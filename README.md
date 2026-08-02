# Tidefall Quartermaster

Tidefall Quartermaster is a Tampermonkey userscript for Tidefall that helps players make smarter crafting and trading decisions by calculating crafting costs, market values, and estimated profits using current exchange data.

## Features

### Crafting Calculator

- Calculates the cost to craft supported items
- Displays estimated profit after the Tidefall exchange tax
- Calculates profit per crafting action
- Shows profit margins for quick comparisons

### Smart Market Pricing

Quartermaster automatically selects the best available market price using the following priority:

1. Lowest Buy Order
2. Lowest Sell Order
3. Last Sold Price
4. Vendor Price (when available)

This helps provide accurate estimates even when market data is limited.

### Resource Chains

- Calculates costs through entire crafting chains
- Compare buying raw materials versus crafting them yourself
- Supports intermediate crafting materials
- Helps identify the most profitable crafting path

### Quartermaster Items

- Includes Quartermaster-exclusive items
- Supports vendor-only items where applicable
- Updated for the latest Tidefall content

### Performance

- Lightweight design with minimal performance impact
- Calculates values locally in your browser
- Updates automatically as exchange prices change

## Installation

1. Install a userscript manager such as Tampermonkey: https://www.tampermonkey.net/
2. Open `Tidefall_Quartermaster.user.js`
3. Click **Raw** in the top-right corner.
4. Click **Install**.
5. Open or refresh Tidefall.

The script runs on:

```
https://www.playtidefall.com/*
```

## Notes

- Tidefall Quartermaster is an unofficial community userscript.
- It is not affiliated with or endorsed by Tidefall.
- Market calculations are estimates based on available exchange data.
- Prices may change as the in-game economy changes.
- Some features depend on Tidefall's current page structure and may require updates after game patches.
