// ==UserScript==
// @name         Tidefall Quartermaster
// @namespace    tidefall-quartermaster
// @version      1.0.23
// @description  Standalone Exchange reader and mastery-aware profit advisor for Tidefall
// @icon         https://www.google.com/s2/favicons?sz=64&domain=playtidefall.com
// @updateURL    https://raw.githubusercontent.com/UserCarl/tidefall-quartermaster/main/Tidefall_Quartermaster.user.js
// @downloadURL  https://raw.githubusercontent.com/UserCarl/tidefall-quartermaster/main/Tidefall_Quartermaster.user.js
// @match        https://www.playtidefall.com/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const VERSION = '1.0.29';
    const BUILD_ID = '2026-08-15-net-worth-clear-history-button';
    const STORAGE_KEY = 'tf-quartermaster-v1';
    const BUTTON_ID = 'tf-quartermaster-button';
    const VENDOR_BUTTON_ID = 'tf-quartermaster-vendor-button';
    const OVERLAY_ID = 'tf-quartermaster-overlay';
    const BUTTON_POSITION_KEY = 'tf-quartermaster-button-position-v1';
    const MARKET_PARSER_VERSION_KEY = 'tf-quartermaster-market-parser-version';
    const MARKET_PARSER_VERSION = 2;
    const EXCLUDE_DEFAULT_MIGRATION_KEY =
        'tf-quartermaster-exclude-default-v1';
    const CITY_INVENTORY_SEED_MIGRATION_KEY =
        'tf-quartermaster-city-inventory-seed-v1';
    const CITY_INVENTORY_RESET_MIGRATION_KEY =
        'tf-quartermaster-city-inventory-reset-v1';
    const JOURNAL_ID = 'tf-quartermaster-journal';
    const JOURNAL_STORAGE_KEY = 'tf-quartermaster-journal-v1';
    const JOURNAL_MAX_LENGTH = 500;
    const NET_WORTH_SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;
    const NET_WORTH_HISTORY_MAX_POINTS = 4032;
    const NET_WORTH_RANGE_OPTIONS = [
        { id: '24h', label: '24H', ms: 24 * 60 * 60 * 1000 },
        { id: '7d', label: '7D', ms: 7 * 24 * 60 * 60 * 1000 },
        { id: '30d', label: '30D', ms: 30 * 24 * 60 * 60 * 1000 },
        { id: 'all', label: 'All', ms: Infinity }
    ];

    function formatGold(value, { allowZero = false } = {}) {
        const amount = Number(value);

        if (!Number.isFinite(amount)) return '—';
        if (!allowZero && amount <= 0) return '—';

        return `${Math.round(amount).toLocaleString()}g`;
    }

    function formatPercent(value, maximumFractionDigits = 1) {
        const amount = Number(value);

        if (!Number.isFinite(amount)) return '—';

        return `${amount.toLocaleString(undefined, {
            minimumFractionDigits: 0,
            maximumFractionDigits
        })}%`;
    }

    const DEFAULT_STATE = {
        taxPercent: 10,
        currentCity: 'None',
        manualCityOverride: false,
        excludeLockedCrafts: true,
        developerMode: false,
        skillLevels: {
            logging: 0,
            mining: 0,
            fishing: 0,
            carpentry: 0,
            smelting: 0,
            cooking: 0,
            smithing: 0,
            gunnery: 0,
            crafting: 0,
            navigation: 0
        },
        mastery: {
            logging: { experience: 0, yield: 0 },
            mining: { experience: 0, yield: 0 },
            fishing: { experience: 0, yield: 0 },
            carpentry: { experience: 0, yield: 5 },
            smelting: { experience: 0, yield: 5 },
            cooking: { experience: 0, yield: 0 },
            smithing: { experience: 0, yield: 0 },
            gunnery: { experience: 0, yield: 0 },
            crafting: { experience: 0, yield: 1 },
            navigation: { experience: 0, yield: 0 }
        },
        prices: {},
        xpRecipes: {},
        skillProgress: {},
        progressPlanner: {
            skill: 'smelting',
            itemKey: 'smelting:mithril bar',
            targetLevel: 40
        },
        vendorDebug: {
            status: 'Not scanned',
            itemId: null,
            itemName: '',
            rawText: '',
            parsedPrice: 0,
            saved: false,
            scannedAt: 0
        },
        inventoryCache: {
            items: {},
            warehouseItems: {},
            cargoItems: {},
            hasRoundedValues: false,
            updatedAt: 0
        },
        shipBuilder: {
            selectedShip: 'Brig',
            name: 'Brig Standard',
            wood: 'Fenn',
            metal: 'Darkiron',
            planks: 4500,
            beams: 2400,
            nails: 2370,
            shipwrightFee: 21800,
            inventory: {
                logs: 0,
                ore: 0,
                bars: 0,
                nails: 0,
                planks: 0,
                beams: 0
            },
            manualInventoryOverride: false,
            inventoryPanelOpen: false,
            inventoryPanelPosition: {
                left: 80,
                top: 120
            }
        },
        craftingPlanner: {
            selectedGroup: 'Carpentry',
            selectedRecipe: 'wood:Pine:plank',
            quantity: 1,
            queue: []
        },
        masterySimulator: {
            allocations: {}
        },
        preferences: {
            compactMode: false,
            fontSize: 'normal',
            theme: 'dark',
            includeWarehouseInventory: true,
            includeShipInventory: true,
            showRawMaterials: true,
            showIntermediateMaterials: true,
            showShipProgress: true,
            autoRefreshInventory: true,
            showBuyCraftRecommendations: false,
            netWorthHistoryRange: '7d',

            // Economy / inspector feature controls
            itemInspectorEnabled: true,
            showPriceFreshness: true,
            pinnedComparisonEnabled: true,
            showInspectorCraftCapacity: true,
            showLockedSkillRows: true,

            // Developer-only diagnostics
            showCalculationSourceIndicators: false
        },
        masteryUpdatedAt: 0,
        updatedAt: 0,
        netWorthHistory: [],
        cityInventories: {}
    };

    const WOODS = [
        'Pine', 'Oak', 'Fallow', 'Fenn', 'Bracken',
        'Tallow', 'Madder', 'Silkwood', 'Flint', 'Holtwood'
    ];

    const METALS = [
        'Copper', 'Iron', 'Cinder', 'Darkiron', 'Mithril',
        'Adamantite', 'Starmetal', 'Stormglass', 'Leviathan', 'Abyssal'
    ];

    /*
     * Tier 1 standard ship requirements, totaled across Keel, Hull, Mast,
     * and Rudder from the in-game shipyard.
     */
    const SHIP_PRESETS = {
        Skiff: {
            name: 'Skiff Standard',
            wood: 'Pine',
            metal: 'Copper',
            planks: 90,
            beams: 47,
            nails: 64,
            shipwrightFee: 455,
            buildTime: '11m 58s'
        },
        Cutter: {
            name: 'Cutter Standard',
            wood: 'Oak',
            metal: 'Iron',
            planks: 750,
            beams: 400,
            nails: 395,
            shipwrightFee: 3675,
            buildTime: '1h 36m'
        },
        Sloop: {
            name: 'Sloop Standard',
            wood: 'Fallow',
            metal: 'Cinder',
            planks: 1875,
            beams: 1000,
            nails: 990,
            shipwrightFee: 9000,
            buildTime: '4h 2m'
        },
        Brig: {
            name: 'Brig Standard',
            wood: 'Fenn',
            metal: 'Darkiron',
            planks: 4500,
            beams: 2400,
            nails: 2370,
            shipwrightFee: 21800,
            buildTime: '9h 41m'
        },
        Brigantine: {
            name: 'Brigantine Standard',
            wood: 'Bracken',
            metal: 'Mithril',
            planks: 9000,
            beams: 4800,
            nails: 4740,
            shipwrightFee: 43400,
            buildTime: '19h 22m'
        },
        Corvette: {
            name: 'Corvette Standard',
            wood: 'Tallow',
            metal: 'Adamantite',
            planks: 16000,
            beams: 8000,
            nails: 8500,
            shipwrightFee: 75000,
            buildTime: '1d 9h'
        },
        Frigate: {
            name: 'Frigate Standard',
            wood: 'Madder',
            metal: 'Starmetal',
            planks: 32000,
            beams: 14000,
            nails: 15750,
            shipwrightFee: 139500,
            buildTime: '2d 9h'
        },
        Galleon: {
            name: 'Galleon Standard',
            wood: 'Silkwood',
            metal: 'Stormglass',
            planks: 48000,
            beams: 22000,
            nails: 23750,
            shipwrightFee: 214000,
            buildTime: '3d 22h'
        },
        'Man-of-War': {
            name: 'Man-of-War Standard',
            wood: 'Flint',
            metal: 'Leviathan',
            planks: 78000,
            beams: 36000,
            nails: 38500,
            shipwrightFee: 348000,
            buildTime: '6d 10h'
        },
        'Ship of the Line': {
            name: 'Ship of the Line Standard',
            wood: 'Holtwood',
            metal: 'Abyssal',
            planks: 120000,
            beams: 56000,
            nails: 60000,
            shipwrightFee: 540000,
            buildTime: '9d 23h'
        }
    };

    /*
     * Verified base Carpentry cycle times. City speed bonuses are applied
     * dynamically and are not baked into these values.
     */
    const WOOD_CRAFT_TIMES = {
        Pine: { plank: 6, beam: 12 },
        Oak: { plank: 10, beam: 20 },
        Fallow: { plank: 14, beam: 28 },
        Fenn: { plank: 18, beam: 36 },
        Bracken: { plank: 22, beam: 44 },
        Tallow: { plank: 30, beam: 60 },
        Madder: { plank: 38, beam: 76 },
        Silkwood: { plank: 46, beam: 92 },
        Flint: { plank: 52, beam: 104 },
        Holtwood: { plank: 60, beam: 120 }
    };

    const METAL_CRAFT_TIMES = {
        Copper: { bar: 8, nail: 4 },
        Iron: { bar: 15, nail: 5 },
        Cinder: { bar: 23, nail: 6 },
        Darkiron: { bar: 27, nail: 8 },
        Mithril: { bar: 31, nail: 10 },
        Adamantite: { bar: 36, nail: 12 },
        Starmetal: { bar: 40, nail: 15 },
        Stormglass: { bar: 44, nail: 18 },
        Leviathan: { bar: 50, nail: 25 },
        Abyssal: { bar: 60, nail: 35 }
    };

    const CITY_BONUSES = {
        None: {},
        'Caelthar Reach': { carpentry: 0.05 },
        Emberfall: { smithing: 0.20, smelting: 0.05 },
        Driftmeadow: { cooking: 0.20 }
    };

    const WOOD_REQUIRED_LEVELS = {
        Pine: 1,
        Oak: 5,
        Fallow: 10,
        Fenn: 15,
        Bracken: 25,
        Tallow: 40,
        Madder: 55,
        Silkwood: 70,
        Flint: 75,
        Holtwood: 90
    };

    const BAR_REQUIRED_LEVELS = {
        Copper: 1,
        Iron: 5,
        Cinder: 10,
        Darkiron: 15,
        Mithril: 25,
        Adamantite: 40,
        Starmetal: 55,
        Stormglass: 70,
        Leviathan: 75,
        Abyssal: 90
    };

    const MINING_REQUIRED_LEVELS = {
        Copper: 1,
        Iron: 5,
        Cinder: 10,
        Darkiron: 15,
        Mithril: 25,
        Adamantite: 40,
        Starmetal: 55,
        Stormglass: 70,
        Leviathan: 75,
        Abyssal: 90
    };

    const NAIL_REQUIRED_LEVELS = {
        Copper: 1,
        Iron: 5,
        Cinder: 10,
        Darkiron: 15,
        Mithril: 25,
        Adamantite: 40,
        Starmetal: 55,
        Stormglass: 70,
        Leviathan: 80,
        Abyssal: 90
    };

    /*
     * Verified log vendor values. Tidefall's gold supply fee for smelting
     * matches the vendor value of the corresponding fuel-log tier.
     */
    const VENDOR_LOG_VALUES = {
        Pine: 2,
        Oak: 4,
        Fallow: 6,
        Fenn: 8,
        Bracken: 10,
        Tallow: 15,
        Madder: 20,
        Silkwood: 26,
        Flint: 33,
        Holtwood: 42
    };

    const METAL_FUEL_LOG = {
        Copper: 'Pine',
        Iron: 'Oak',
        Cinder: 'Fallow',
        Darkiron: 'Fenn',
        Mithril: 'Bracken',
        Adamantite: 'Tallow',
        Starmetal: 'Madder',
        Stormglass: 'Silkwood',
        Leviathan: 'Flint',
        Abyssal: 'Holtwood'
    };

    const SMELTING_SUPPLY_FEES = Object.fromEntries(
        Object.entries(METAL_FUEL_LOG).map(([metal, wood]) => [
            metal,
            {
                fee: VENDOR_LOG_VALUES[wood],
                estimated: false,
                fuelLog: `${wood} Log`
            }
        ])
    );

    const SHOT_TYPES = ['Round Shot', 'Chain Shot', 'Grape Shot'];

    /*
     * Verified vendor value for all ammunition variants in each metal tier.
     * Round Shot, Chain Shot, and Grape Shot share the same vendor price.
     */
    const BUILT_IN_SHOT_VENDOR_PRICES = {
        Copper: 3,
        Iron: 6,
        Cinder: 9,
        Darkiron: 11,
        Mithril: 12,
        Adamantite: 21,
        Starmetal: 25,
        Stormglass: 34,
        Leviathan: 55,
        Abyssal: 105
    };

    /*
     * Verified vendor prices captured from Tidefall's Exchange item details.
     * These are temporary built-in values until database access is available.
     */
    const BUILT_IN_VENDOR_PRICES = {
        'Abyssal 42-Pounder': 73000,
        'Abyssal Bar': 132,
        'Abyssal Nails': 105,
        'Abyssal Ore': 44,
        'Adamantite 12-Pounder': 4750,
        'Adamantite Bar': 57,
        'Adamantite Nails': 20,
        'Adamantite Ore': 19,
        'Silkwood Beam': 156,
        'Silkwood Plank': 52,
        'Caulking Kit': 54,
        'Cinder 6-Pounder': 1300,
        'Cinder Bar': 30,
        'Cinder Nails': 9,
        'Cinder Ore': 10,
        'Cod': 11,
        'Cod Stew': 22,
        'Copper 2-Pounder': 325,
        'Copper Bar': 9,
        'Copper Nails': 3,
        'Copper Ore': 3,
        'Crumb Bait': 1,
        'Darkiron 8-Pounder': 1975,
        'Darkiron Bar': 39,
        'Darkiron Nails': 10,
        'Darkiron Ore': 13,
        'Deck Repair Kit': 190,
        'Deepfin Steaks': 60,
        'Deepfin Tuna': 30,
        'Deepwater Bait': 10,
        'Dreadwhale': 37,
        'Dreadwhale Feast': 90,
        'Dried Sardines': 18,
        'Eel Bait': 8,
        'Holtwood Beam': 252,
        'Holtwood Plank': 84,
        'Grilled Salmon': 30,
        'Hull Repair Kit': 92,
        'Hull Restoration Kit': 1350,
        'Iron 4-Pounder': 725,
        'Iron Bar': 18,
        'Iron Nails': 6,
        'Iron Ore': 6,
        'Flint Beam': 198,
        'Flint Plank': 66,
        'Leviathan 32-Pounder': 28000,
        'Leviathan Bar': 99,
        'Leviathan Nails': 54,
        'Leviathan Ore': 33,
        'Mackerel': 5,
        'Tallow Beam': 90,
        'Tallow Plank': 30,
        'Fenn Beam': 48,
        'Fenn Plank': 16,
        'Master Refit Crate': 3350,
        'Master Repair Kit': 745,
        'Minnow Bait': 4,
        'Mithril 9-Pounder': 2850,
        'Mithril Bar': 45,
        'Mithril Nails': 12,
        'Mithril Ore': 15,
        'Oak Beam': 24,
        'Oak Plank': 8,
        'Patch Kit': 13,
        'Pine Beam': 12,
        'Pine Plank': 4,
        'Refit Crate': 1200,
        'Reinforcement Kit': 245,
        'Salmon': 15,
        'Salted Mackerel': 10,
        'Sandflea Bait': 5,
        'Sardine': 9,
        'Shark': 24,
        'Shark Haunch': 48,
        'Shipwright Kit': 530,
        'Shrimp Bait': 6,
        'Silverchum Bait': 9,
        'Softshell Bait': 3,
        'Squid Strip Bait': 7,
        'Starmetal 18-Pounder': 7650,
        'Starmetal Bar': 69,
        'Starmetal Nails': 24,
        'Starmetal Ore': 23,
        'Stormglass 24-Pounder': 13000,
        'Stormglass Bar': 81,
        'Stormglass Nails': 34,
        'Stormglass Ore': 27,
        'Stormray': 33,
        'Stormray Fillet': 68,
        'Swordfish': 21,
        'Swordfish Cuts': 42,
        'Bracken Beam': 60,
        'Bracken Plank': 20,
        'Tuna': 16,
        'Tuna Rations': 14,
        'Fallow Beam': 36,
        'Fallow Plank': 12,
        'Worm Bait': 2,
        'Madder Beam': 120,
        'Madder Plank': 40
    };

    /*
     * BUILT_IN_VENDOR_PRICES is static, so this lookup map is built once
     * instead of re-scanning the table on every builtInVendorPrice() call.
     */
    const BUILT_IN_VENDOR_PRICES_BY_NORMALIZED_NAME = new Map(
        Object.entries(BUILT_IN_VENDOR_PRICES).map(([name, price]) => [
            normalizeName(name).toLowerCase(),
            price
        ])
    );

    function builtInVendorPrice(itemName) {
        const normalized = normalizeName(itemName);
        if (!normalized) return 0;

        if (
            BUILT_IN_VENDOR_PRICES_BY_NORMALIZED_NAME.has(
                normalized.toLowerCase()
            )
        ) {
            return Number(
                BUILT_IN_VENDOR_PRICES_BY_NORMALIZED_NAME.get(
                    normalized.toLowerCase()
                ) || 0
            );
        }

        const wood = WOODS.find(candidate =>
            normalized.toLowerCase() ===
            `${candidate} Log`.toLowerCase() ||
            normalized.toLowerCase() ===
            `${candidate} Logs`.toLowerCase()
        );

        if (wood) {
            return Number(VENDOR_LOG_VALUES[wood] || 0);
        }

        for (const metal of METALS) {
            for (const type of SHOT_TYPES) {
                if (
                    normalized.toLowerCase() ===
                    `${metal} ${type}`.toLowerCase()
                ) {
                    return Number(
                        BUILT_IN_SHOT_VENDOR_PRICES[metal] || 0
                    );
                }
            }
        }

        return 0;
    }

    function ensureVendorRecord(itemName, vendorPrice, source) {
        const price = Number(vendorPrice || 0);
        if (!itemName || !(price > 0)) return;

        const existing = state.prices[itemName] || {
            name: itemName,
            ask: 0,
            bid: 0,
            spread: 0,
            weeklyVolume: 0,
            lastSold: 0
        };

        state.prices[itemName] = {
            ...existing,
            name: itemName,
            vendorPrice:
                Number(existing.vendorPrice || 0) > 0
                    ? Number(existing.vendorPrice)
                    : price,
            source:
                Number(existing.vendorPrice || 0) > 0
                    ? existing.source
                    : source,
            capturedAt: existing.capturedAt || Date.now()
        };
    }

    function preloadKnownVendorPrices() {
        Object.entries(BUILT_IN_VENDOR_PRICES).forEach(
            ([itemName, price]) => {
                ensureVendorRecord(
                    itemName,
                    price,
                    'built-in-vendor'
                );
            }
        );

        Object.entries(VENDOR_LOG_VALUES).forEach(([wood, price]) => {
            ensureVendorRecord(
                `${wood} Log`,
                price,
                'built-in-vendor'
            );
        });

        Object.entries(BUILT_IN_SHOT_VENDOR_PRICES).forEach(
            ([metal, price]) => {
                SHOT_TYPES.forEach(type => {
                    ensureVendorRecord(
                        `${metal} ${type}`,
                        price,
                        'built-in-shot-vendor'
                    );
                });
            }
        );
    }

    function propagateShotVendorPrice(itemName, vendorPrice) {
        const normalized = normalizeName(itemName);
        const metal = METALS.find(candidate =>
            SHOT_TYPES.some(type =>
                normalized.toLowerCase() ===
                `${candidate} ${type}`.toLowerCase()
            )
        );

        if (!metal) return false;

        SHOT_TYPES.forEach(type => {
            ensureVendorRecord(
                `${metal} ${type}`,
                vendorPrice,
                'derived-shot-vendor'
            );
        });

        return true;
    }

    function propagateShotMarketRecord(itemName, sourceRecord) {
        const normalized = normalizeName(itemName);
        const metal = METALS.find(candidate =>
            SHOT_TYPES.some(type =>
                normalized.toLowerCase() ===
                `${candidate} ${type}`.toLowerCase()
            )
        );

        if (!metal || !sourceRecord) return false;

        SHOT_TYPES.forEach(type => {
            const targetName = `${metal} ${type}`;
            const existing = state.prices[targetName] || {
                name: targetName,
                ask: 0,
                bid: 0,
                spread: 0,
                weeklyVolume: 0,
                lastSold: 0,
                vendorPrice: 0
            };

            state.prices[targetName] = {
                ...existing,
                name: targetName,
                ask: Number(sourceRecord.ask || existing.ask || 0),
                bid: Number(sourceRecord.bid || existing.bid || 0),
                spread: Number(
                    sourceRecord.spread || existing.spread || 0
                ),
                weeklyVolume: Number(
                    sourceRecord.weeklyVolume ||
                    existing.weeklyVolume ||
                    0
                ),
                lastSold: Number(
                    sourceRecord.lastSold ||
                    existing.lastSold ||
                    0
                ),
                vendorPrice: Number(
                    sourceRecord.vendorPrice ||
                    existing.vendorPrice ||
                    0
                ),
                askDepth: Array.isArray(sourceRecord.askDepth)
                    ? sourceRecord.askDepth.map(level => ({ ...level }))
                    : (existing.askDepth || []),
                bidDepth: Array.isArray(sourceRecord.bidDepth)
                    ? sourceRecord.bidDepth.map(level => ({ ...level }))
                    : (existing.bidDepth || []),
                askQuantity: Number(
                    sourceRecord.askQuantity ||
                    existing.askQuantity ||
                    0
                ),
                bidQuantity: Number(
                    sourceRecord.bidQuantity ||
                    existing.bidQuantity ||
                    0
                ),
                depthCapturedAt: Number(
                    sourceRecord.depthCapturedAt ||
                    existing.depthCapturedAt ||
                    0
                ),
                source:
                    targetName === itemName
                        ? sourceRecord.source || existing.source
                        : 'derived-shot-market',
                capturedAt: Date.now()
            };
        });

        return true;
    }

    const SHOT_OUTPUT_PER_BATCH = 3;

    const SHOT_REQUIRED_LEVELS = {
        Copper: 1,
        Iron: 5,
        Cinder: 10,
        Darkiron: 20,
        Mithril: 30,
        Adamantite: 40,
        Starmetal: 50,
        Stormglass: 60,
        Leviathan: 70,
        Abyssal: 80
    };

    /*
     * Tidefall uses the same cycle time and supply fee for Round Shot,
     * Chain Shot, and Grape Shot when they use the same metal.
     */
    const SHOT_CRAFT_TIMES = Object.fromEntries(
        METALS.map(metal => [
            metal,
            METAL_CRAFT_TIMES[metal]?.nail || 0
        ])
    );

    const SHOT_SUPPLY_FEES = Object.fromEntries(
        METALS.map(metal => [
            metal,
            {
                ...SMELTING_SUPPLY_FEES[metal]
            }
        ])
    );

    /*
     * Cooking uses one raw fish per batch and the same gold supply-fee value
     * as the corresponding smelting fuel log.
     */
    const COOKING_RECIPES = [
        { item: 'Salted Mackerel', ingredient: 'Mackerel', level: 1, cycle: 5, fee: 2, fuelLog: 'Pine Log' },
        { item: 'Dried Sardines', ingredient: 'Sardine', level: 5, cycle: 6, fee: 2, fuelLog: 'Pine Log' },
        { item: 'Cod Stew', ingredient: 'Cod', level: 10, cycle: 10, fee: 4, fuelLog: 'Oak Log' },
        { item: 'Grilled Salmon', ingredient: 'Salmon', level: 20, cycle: 15, fee: 6, fuelLog: 'Fallow Log' },
        { item: 'Tuna Rations', ingredient: 'Tuna', level: 30, cycle: 18, fee: 4, fuelLog: 'Oak Log' },
        { item: 'Swordfish Cuts', ingredient: 'Swordfish', level: 40, cycle: 22, fee: 8, fuelLog: 'Fenn Log' },
        { item: 'Shark Haunch', ingredient: 'Shark', level: 50, cycle: 28, fee: 10, fuelLog: 'Bracken Log' },
        { item: 'Deepfin Steaks', ingredient: 'Deepfin Tuna', level: 60, cycle: 35, fee: 15, fuelLog: 'Tallow Log' },
        { item: 'Stormray Fillet', ingredient: 'Stormray', level: 80, cycle: 45, fee: 26, fuelLog: 'Silkwood Log' },
        { item: 'Dreadwhale Feast', ingredient: 'Dreadwhale', level: 90, cycle: 60, fee: 42, fuelLog: 'Holtwood Log' }
    ];

    const SUPPORTED_XP_SKILLS = [
        'logging',
        'mining',
        'fishing',
        'carpentry',
        'smelting',
        'smithing',
        'cooking',
        'crafting'
    ];

    const BUILT_IN_XP_RECIPES = [
        // Logging
        { skill: 'logging', item: 'Pine Log', level: 1, xp: 2, cycle: 6, ingredients: [] },
        { skill: 'logging', item: 'Oak Log', level: 5, xp: 5, cycle: 10, ingredients: [] },
        { skill: 'logging', item: 'Fallow Log', level: 10, xp: 8, cycle: 14, ingredients: [] },
        { skill: 'logging', item: 'Fenn Log', level: 15, xp: 12, cycle: 18, ingredients: [] },
        { skill: 'logging', item: 'Bracken Log', level: 25, xp: 18, cycle: 22, ingredients: [] },
        { skill: 'logging', item: 'Tallow Log', level: 40, xp: 25, cycle: 30, ingredients: [] },
        { skill: 'logging', item: 'Madder Log', level: 55, xp: 32, cycle: 38, ingredients: [] },
        { skill: 'logging', item: 'Silkwood Log', level: 65, xp: 40, cycle: 46, ingredients: [] },
        { skill: 'logging', item: 'Flint Log', level: 75, xp: 50, cycle: 52, ingredients: [] },
        { skill: 'logging', item: 'Holtwood Log', level: 90, xp: 60, cycle: 60, ingredients: [] },

        // Mining
        { skill: 'mining', item: 'Copper Ore', level: 1, xp: 2, cycle: 8, ingredients: [] },
        { skill: 'mining', item: 'Iron Ore', level: 5, xp: 5, cycle: 15, ingredients: [] },
        { skill: 'mining', item: 'Cinder Ore', level: 10, xp: 10, cycle: 23, ingredients: [] },
        { skill: 'mining', item: 'Darkiron Ore', level: 15, xp: 15, cycle: 27, ingredients: [] },
        { skill: 'mining', item: 'Mithril Ore', level: 25, xp: 21, cycle: 31, ingredients: [] },
        { skill: 'mining', item: 'Adamantite Ore', level: 40, xp: 27, cycle: 36, ingredients: [] },
        { skill: 'mining', item: 'Starmetal Ore', level: 55, xp: 35, cycle: 40, ingredients: [] },
        { skill: 'mining', item: 'Stormglass Ore', level: 70, xp: 42, cycle: 44, ingredients: [] },
        { skill: 'mining', item: 'Leviathan Ore', level: 75, xp: 49, cycle: 50, ingredients: [] },
        { skill: 'mining', item: 'Abyssal Ore', level: 90, xp: 60, cycle: 60, ingredients: [] },

        // Fishing
        { skill: 'fishing', item: 'Mackerel', level: 1, xp: 2, cycle: 7, ingredients: [{ name: 'Crumb Bait', quantity: 1 }] },
        { skill: 'fishing', item: 'Sardine', level: 5, xp: 6, cycle: 12, ingredients: [{ name: 'Worm Bait', quantity: 1 }] },
        { skill: 'fishing', item: 'Cod', level: 10, xp: 8, cycle: 14, ingredients: [{ name: 'Softshell Bait', quantity: 1 }] },
        { skill: 'fishing', item: 'Salmon', level: 20, xp: 13, cycle: 18, ingredients: [{ name: 'Minnow Bait', quantity: 1 }] },
        { skill: 'fishing', item: 'Tuna', level: 30, xp: 16, cycle: 21, ingredients: [{ name: 'Sandflea Bait', quantity: 1 }] },
        { skill: 'fishing', item: 'Swordfish', level: 40, xp: 22, cycle: 27, ingredients: [{ name: 'Shrimp Bait', quantity: 1 }] },
        { skill: 'fishing', item: 'Shark', level: 50, xp: 27, cycle: 31, ingredients: [{ name: 'Squid Strip Bait', quantity: 1 }] },
        { skill: 'fishing', item: 'Deepfin Tuna', level: 60, xp: 35, cycle: 40, ingredients: [{ name: 'Eel Bait', quantity: 1 }] },
        { skill: 'fishing', item: 'Stormray', level: 70, xp: 40, cycle: 41, ingredients: [{ name: 'Silverchum Bait', quantity: 1 }] },
        { skill: 'fishing', item: 'Dreadwhale', level: 80, xp: 55, cycle: 45, ingredients: [{ name: 'Deepwater Bait', quantity: 1 }] },

        // Carpentry
        { skill: 'carpentry', item: 'Pine Plank', level: 1, xp: 2, cycle: 6, ingredients: [{ name: 'Pine Log', quantity: 1 }] },
        { skill: 'carpentry', item: 'Pine Beam', level: 1, xp: 4, cycle: 12, ingredients: [{ name: 'Pine Plank', quantity: 2 }] },
        { skill: 'carpentry', item: 'Oak Plank', level: 5, xp: 5, cycle: 10, ingredients: [{ name: 'Oak Log', quantity: 1 }] },
        { skill: 'carpentry', item: 'Oak Beam', level: 5, xp: 10, cycle: 20, ingredients: [{ name: 'Oak Plank', quantity: 2 }] },
        { skill: 'carpentry', item: 'Fallow Plank', level: 10, xp: 8, cycle: 14, ingredients: [{ name: 'Fallow Log', quantity: 1 }] },
        { skill: 'carpentry', item: 'Fallow Beam', level: 10, xp: 16, cycle: 28, ingredients: [{ name: 'Fallow Plank', quantity: 2 }] },
        { skill: 'carpentry', item: 'Fenn Plank', level: 15, xp: 12, cycle: 18, ingredients: [{ name: 'Fenn Log', quantity: 1 }] },
        { skill: 'carpentry', item: 'Fenn Beam', level: 15, xp: 24, cycle: 36, ingredients: [{ name: 'Fenn Plank', quantity: 2 }] },
        { skill: 'carpentry', item: 'Bracken Plank', level: 25, xp: 18, cycle: 22, ingredients: [{ name: 'Bracken Log', quantity: 1 }] },
        { skill: 'carpentry', item: 'Bracken Beam', level: 25, xp: 36, cycle: 44, ingredients: [{ name: 'Bracken Plank', quantity: 2 }] },
        { skill: 'carpentry', item: 'Tallow Plank', level: 40, xp: 25, cycle: 30, ingredients: [{ name: 'Tallow Log', quantity: 1 }] },
        { skill: 'carpentry', item: 'Tallow Beam', level: 40, xp: 50, cycle: 60, ingredients: [{ name: 'Tallow Plank', quantity: 2 }] },
        { skill: 'carpentry', item: 'Madder Plank', level: 55, xp: 32, cycle: 38, ingredients: [{ name: 'Madder Log', quantity: 1 }] },
        { skill: 'carpentry', item: 'Madder Beam', level: 55, xp: 64, cycle: 76, ingredients: [{ name: 'Madder Plank', quantity: 2 }] },
        { skill: 'carpentry', item: 'Silkwood Plank', level: 70, xp: 40, cycle: 46, ingredients: [{ name: 'Silkwood Log', quantity: 1 }] },
        { skill: 'carpentry', item: 'Silkwood Beam', level: 70, xp: 80, cycle: 92, ingredients: [{ name: 'Silkwood Plank', quantity: 2 }] },
        { skill: 'carpentry', item: 'Flint Plank', level: 75, xp: 50, cycle: 52, ingredients: [{ name: 'Flint Log', quantity: 1 }] },
        { skill: 'carpentry', item: 'Flint Beam', level: 75, xp: 100, cycle: 104, ingredients: [{ name: 'Flint Plank', quantity: 2 }] },
        { skill: 'carpentry', item: 'Holtwood Plank', level: 90, xp: 60, cycle: 60, ingredients: [{ name: 'Holtwood Log', quantity: 1 }] },
        { skill: 'carpentry', item: 'Holtwood Beam', level: 90, xp: 120, cycle: 120, ingredients: [{ name: 'Holtwood Plank', quantity: 2 }] },

        // Smelting
        { skill: 'smelting', item: 'Copper Bar', level: 1, xp: 2, cycle: 8, ingredients: [{ name: 'Copper Ore', quantity: 2 }] },
        { skill: 'smelting', item: 'Iron Bar', level: 5, xp: 6, cycle: 15, ingredients: [{ name: 'Iron Ore', quantity: 2 }] },
        { skill: 'smelting', item: 'Cinder Bar', level: 10, xp: 10, cycle: 23, ingredients: [{ name: 'Cinder Ore', quantity: 2 }] },
        { skill: 'smelting', item: 'Darkiron Bar', level: 15, xp: 14, cycle: 27, ingredients: [{ name: 'Darkiron Ore', quantity: 2 }] },
        { skill: 'smelting', item: 'Mithril Bar', level: 25, xp: 22, cycle: 31, ingredients: [{ name: 'Mithril Ore', quantity: 2 }] },
        { skill: 'smelting', item: 'Adamantite Bar', level: 40, xp: 30, cycle: 36, ingredients: [{ name: 'Adamantite Ore', quantity: 2 }] },
        { skill: 'smelting', item: 'Starmetal Bar', level: 55, xp: 38, cycle: 40, ingredients: [{ name: 'Starmetal Ore', quantity: 2 }] },
        { skill: 'smelting', item: 'Stormglass Bar', level: 70, xp: 48, cycle: 44, ingredients: [{ name: 'Stormglass Ore', quantity: 2 }] },
        { skill: 'smelting', item: 'Leviathan Bar', level: 75, xp: 58, cycle: 50, ingredients: [{ name: 'Leviathan Ore', quantity: 2 }] },
        { skill: 'smelting', item: 'Abyssal Bar', level: 90, xp: 72, cycle: 60, ingredients: [{ name: 'Abyssal Ore', quantity: 2 }] },

        // Smithing
        // Verified from the in-game Smithing recipe cards on 2026-08-12.
        // The screenshots were taken in Emberfall with its 20% Smithing speed
        // bonus active, so these are the unbonused base cycle times. The normal
        // city-speed calculation applies Emberfall's 20% reduction at runtime.
        { skill: 'smithing', item: 'Copper Round Shot', level: 1, xp: 2, cycle: 4, ingredients: [{ name: 'Copper Bar', quantity: 1 }] },
        { skill: 'smithing', item: 'Copper Chain Shot', level: 1, xp: 2, cycle: 4, ingredients: [{ name: 'Copper Bar', quantity: 1 }] },
        { skill: 'smithing', item: 'Copper Grape Shot', level: 1, xp: 2, cycle: 4, ingredients: [{ name: 'Copper Bar', quantity: 1 }] },
        { skill: 'smithing', item: 'Copper 2-Pounder', level: 1, xp: 13, cycle: 30, ingredients: [{ name: 'Copper Bar', quantity: 20 }, { name: 'Pine Beam', quantity: 5 }] },

        { skill: 'smithing', item: 'Iron Round Shot', level: 5, xp: 6, cycle: 5, ingredients: [{ name: 'Iron Bar', quantity: 1 }] },
        { skill: 'smithing', item: 'Iron Chain Shot', level: 5, xp: 6, cycle: 5, ingredients: [{ name: 'Iron Bar', quantity: 1 }] },
        { skill: 'smithing', item: 'Iron Grape Shot', level: 5, xp: 6, cycle: 5, ingredients: [{ name: 'Iron Bar', quantity: 1 }] },
        { skill: 'smithing', item: 'Iron 4-Pounder', level: 5, xp: 23, cycle: 45, ingredients: [{ name: 'Iron Bar', quantity: 22 }, { name: 'Oak Beam', quantity: 6 }] },

        { skill: 'smithing', item: 'Cinder Round Shot', level: 10, xp: 10, cycle: 6, ingredients: [{ name: 'Cinder Bar', quantity: 1 }] },
        { skill: 'smithing', item: 'Cinder Chain Shot', level: 10, xp: 10, cycle: 6, ingredients: [{ name: 'Cinder Bar', quantity: 1 }] },
        { skill: 'smithing', item: 'Cinder Grape Shot', level: 10, xp: 10, cycle: 6, ingredients: [{ name: 'Cinder Bar', quantity: 1 }] },
        { skill: 'smithing', item: 'Cinder 6-Pounder', level: 10, xp: 35, cycle: 60, ingredients: [{ name: 'Cinder Bar', quantity: 24 }, { name: 'Fallow Beam', quantity: 7 }] },

        { skill: 'smithing', item: 'Darkiron Round Shot', level: 20, xp: 14, cycle: 8, ingredients: [{ name: 'Darkiron Bar', quantity: 1 }] },
        { skill: 'smithing', item: 'Darkiron Chain Shot', level: 20, xp: 14, cycle: 8, ingredients: [{ name: 'Darkiron Bar', quantity: 1 }] },
        { skill: 'smithing', item: 'Darkiron Grape Shot', level: 20, xp: 14, cycle: 8, ingredients: [{ name: 'Darkiron Bar', quantity: 1 }] },
        { skill: 'smithing', item: 'Darkiron 8-Pounder', level: 20, xp: 60, cycle: 90, ingredients: [{ name: 'Darkiron Bar', quantity: 28 }, { name: 'Fenn Beam', quantity: 8 }] },

        { skill: 'smithing', item: 'Mithril Round Shot', level: 30, xp: 20, cycle: 10, ingredients: [{ name: 'Mithril Bar', quantity: 1 }] },
        { skill: 'smithing', item: 'Mithril Chain Shot', level: 30, xp: 20, cycle: 10, ingredients: [{ name: 'Mithril Bar', quantity: 1 }] },
        { skill: 'smithing', item: 'Mithril Grape Shot', level: 30, xp: 20, cycle: 10, ingredients: [{ name: 'Mithril Bar', quantity: 1 }] },
        { skill: 'smithing', item: 'Mithril 9-Pounder', level: 30, xp: 90, cycle: 120, ingredients: [{ name: 'Mithril Bar', quantity: 34 }, { name: 'Bracken Beam', quantity: 10 }] },

        { skill: 'smithing', item: 'Adamantite Round Shot', level: 40, xp: 26, cycle: 12, ingredients: [{ name: 'Adamantite Bar', quantity: 1 }] },
        { skill: 'smithing', item: 'Adamantite Chain Shot', level: 40, xp: 26, cycle: 12, ingredients: [{ name: 'Adamantite Bar', quantity: 1 }] },
        { skill: 'smithing', item: 'Adamantite Grape Shot', level: 40, xp: 26, cycle: 12, ingredients: [{ name: 'Adamantite Bar', quantity: 1 }] },
        { skill: 'smithing', item: 'Adamantite 12-Pounder', level: 40, xp: 150, cycle: 180, ingredients: [{ name: 'Adamantite Bar', quantity: 42 }, { name: 'Tallow Beam', quantity: 13 }] },

        { skill: 'smithing', item: 'Starmetal Round Shot', level: 50, xp: 32, cycle: 15, ingredients: [{ name: 'Starmetal Bar', quantity: 1 }] },
        { skill: 'smithing', item: 'Starmetal Chain Shot', level: 50, xp: 32, cycle: 15, ingredients: [{ name: 'Starmetal Bar', quantity: 1 }] },
        { skill: 'smithing', item: 'Starmetal Grape Shot', level: 50, xp: 32, cycle: 15, ingredients: [{ name: 'Starmetal Bar', quantity: 1 }] },
        { skill: 'smithing', item: 'Starmetal 18-Pounder', level: 50, xp: 275, cycle: 300, ingredients: [{ name: 'Starmetal Bar', quantity: 55 }, { name: 'Madder Beam', quantity: 17 }] },

        { skill: 'smithing', item: 'Stormglass Round Shot', level: 60, xp: 38, cycle: 18, ingredients: [{ name: 'Stormglass Bar', quantity: 1 }] },
        { skill: 'smithing', item: 'Stormglass Chain Shot', level: 60, xp: 38, cycle: 18, ingredients: [{ name: 'Stormglass Bar', quantity: 1 }] },
        { skill: 'smithing', item: 'Stormglass Grape Shot', level: 60, xp: 38, cycle: 18, ingredients: [{ name: 'Stormglass Bar', quantity: 1 }] },
        { skill: 'smithing', item: 'Stormglass 24-Pounder', level: 60, xp: 600, cycle: 600, ingredients: [{ name: 'Stormglass Bar', quantity: 80 }, { name: 'Silkwood Beam', quantity: 24 }] },

        { skill: 'smithing', item: 'Leviathan Round Shot', level: 70, xp: 48, cycle: 25, ingredients: [{ name: 'Leviathan Bar', quantity: 1 }] },
        { skill: 'smithing', item: 'Leviathan Chain Shot', level: 70, xp: 48, cycle: 25, ingredients: [{ name: 'Leviathan Bar', quantity: 1 }] },
        { skill: 'smithing', item: 'Leviathan Grape Shot', level: 70, xp: 48, cycle: 25, ingredients: [{ name: 'Leviathan Bar', quantity: 1 }] },
        { skill: 'smithing', item: 'Leviathan 32-Pounder', level: 70, xp: 975, cycle: 900, ingredients: [{ name: 'Leviathan Bar', quantity: 150 }, { name: 'Flint Beam', quantity: 40 }] },

        { skill: 'smithing', item: 'Abyssal Round Shot', level: 80, xp: 60, cycle: 35, ingredients: [{ name: 'Abyssal Bar', quantity: 1 }] },
        { skill: 'smithing', item: 'Abyssal Chain Shot', level: 80, xp: 60, cycle: 35, ingredients: [{ name: 'Abyssal Bar', quantity: 1 }] },
        { skill: 'smithing', item: 'Abyssal Grape Shot', level: 80, xp: 60, cycle: 35, ingredients: [{ name: 'Abyssal Bar', quantity: 1 }] },
        { skill: 'smithing', item: 'Abyssal 42-Pounder', level: 80, xp: 2100, cycle: 1800, ingredients: [{ name: 'Abyssal Bar', quantity: 350 }, { name: 'Holtwood Beam', quantity: 60 }] },

        // Cooking
        { skill: 'cooking', item: 'Salted Mackerel', level: 1, xp: 7, cycle: 5, ingredients: [{ name: 'Mackerel', quantity: 1 }] },
        { skill: 'cooking', item: 'Dried Sardines', level: 5, xp: 12, cycle: 6, ingredients: [{ name: 'Sardine', quantity: 1 }] },
        { skill: 'cooking', item: 'Cod Stew', level: 10, xp: 25, cycle: 10, ingredients: [{ name: 'Cod', quantity: 1 }] },
        { skill: 'cooking', item: 'Grilled Salmon', level: 20, xp: 45, cycle: 15, ingredients: [{ name: 'Salmon', quantity: 1 }] },
        { skill: 'cooking', item: 'Tuna Rations', level: 30, xp: 65, cycle: 18, ingredients: [{ name: 'Tuna', quantity: 1 }] },
        { skill: 'cooking', item: 'Swordfish Cuts', level: 40, xp: 90, cycle: 22, ingredients: [{ name: 'Swordfish', quantity: 1 }] },
        { skill: 'cooking', item: 'Shark Haunch', level: 50, xp: 130, cycle: 28, ingredients: [{ name: 'Shark', quantity: 1 }] },
        { skill: 'cooking', item: 'Deepfin Steaks', level: 60, xp: 185, cycle: 35, ingredients: [{ name: 'Deepfin Tuna', quantity: 1 }] },
        { skill: 'cooking', item: 'Stormray Fillet', level: 80, xp: 240, cycle: 45, ingredients: [{ name: 'Stormray', quantity: 1 }] },
        { skill: 'cooking', item: 'Dreadwhale Feast', level: 90, xp: 320, cycle: 60, ingredients: [{ name: 'Dreadwhale', quantity: 1 }] },

        // Crafting
        { skill: 'crafting', item: 'Copper Nails', level: 1, xp: 2, cycle: 4, ingredients: [{ name: 'Copper Bar', quantity: 1 }] },
        { skill: 'crafting', item: 'Patch Kit', level: 1, xp: 2, cycle: 10, ingredients: [{ name: 'Copper Nails', quantity: 2 }, { name: 'Pine Plank', quantity: 2 }] },
        { skill: 'crafting', item: 'Iron Nails', level: 5, xp: 6, cycle: 5, ingredients: [{ name: 'Iron Bar', quantity: 1 }] },
        { skill: 'crafting', item: 'Caulking Kit', level: 5, xp: 6, cycle: 14, ingredients: [{ name: 'Iron Nails', quantity: 3 }, { name: 'Oak Plank', quantity: 3 }] },
        { skill: 'crafting', item: 'Cinder Nails', level: 10, xp: 10, cycle: 6, ingredients: [{ name: 'Cinder Bar', quantity: 1 }] },
        { skill: 'crafting', item: 'Hull Repair Kit', level: 10, xp: 10, cycle: 18, ingredients: [{ name: 'Cinder Nails', quantity: 3 }, { name: 'Fallow Plank', quantity: 4 }] },
        { skill: 'crafting', item: 'Darkiron Nails', level: 15, xp: 14, cycle: 8, ingredients: [{ name: 'Darkiron Bar', quantity: 1 }] },
        { skill: 'crafting', item: 'Deck Repair Kit', level: 15, xp: 14, cycle: 22, ingredients: [{ name: 'Darkiron Nails', quantity: 4 }, { name: 'Fenn Plank', quantity: 5 }] },
        { skill: 'crafting', item: 'Mithril Nails', level: 25, xp: 20, cycle: 10, ingredients: [{ name: 'Mithril Bar', quantity: 1 }] },
        { skill: 'crafting', item: 'Reinforcement Kit', level: 25, xp: 22, cycle: 28, ingredients: [{ name: 'Mithril Nails', quantity: 4 }, { name: 'Bracken Plank', quantity: 6 }] },
        { skill: 'crafting', item: 'Adamantite Nails', level: 40, xp: 26, cycle: 12, ingredients: [{ name: 'Adamantite Bar', quantity: 1 }] },
        { skill: 'crafting', item: 'Shipwright Kit', level: 40, xp: 30, cycle: 34, ingredients: [{ name: 'Adamantite Nails', quantity: 5 }, { name: 'Tallow Plank', quantity: 6 }] },
        { skill: 'crafting', item: 'Starmetal Nails', level: 55, xp: 32, cycle: 15, ingredients: [{ name: 'Starmetal Bar', quantity: 1 }] },
        { skill: 'crafting', item: 'Master Repair Kit', level: 55, xp: 38, cycle: 42, ingredients: [{ name: 'Starmetal Nails', quantity: 5 }, { name: 'Madder Plank', quantity: 8 }] },
        { skill: 'crafting', item: 'Stormglass Nails', level: 70, xp: 38, cycle: 18, ingredients: [{ name: 'Stormglass Bar', quantity: 1 }] },
        { skill: 'crafting', item: 'Hull Restoration Kit', level: 70, xp: 48, cycle: 50, ingredients: [{ name: 'Stormglass Nails', quantity: 6 }, { name: 'Silkwood Plank', quantity: 10 }] },
        { skill: 'crafting', item: 'Leviathan Nails', level: 80, xp: 48, cycle: 25, ingredients: [{ name: 'Leviathan Bar', quantity: 1 }] },
        { skill: 'crafting', item: 'Refit Crate', level: 80, xp: 58, cycle: 58, ingredients: [{ name: 'Leviathan Nails', quantity: 8 }, { name: 'Flint Plank', quantity: 12 }] },
        { skill: 'crafting', item: 'Abyssal Nails', level: 90, xp: 60, cycle: 35, ingredients: [{ name: 'Abyssal Bar', quantity: 1 }] },
        { skill: 'crafting', item: 'Master Refit Crate', level: 90, xp: 72, cycle: 70, ingredients: [{ name: 'Abyssal Nails', quantity: 10 }, { name: 'Holtwood Plank', quantity: 15 }] }
    ];

    function xpRecipeKey(skill, item) {
        return `${String(skill || '').toLowerCase()}:${normalizeName(item).toLowerCase()}`;
    }

    /*
     * Lazily-built index for xpRecipeByItem(), invalidated whenever
     * state.xpRecipes is written to (saveXpRecipe, purgeMalformedSmithing
     * XpRecipes) or reloaded wholesale. Avoids re-scanning every known
     * recipe on each call, which matters because xpRecipeByItem() is
     * called recursively per ingredient inside expandBaseMaterials().
     */
    let xpRecipeByItemCache = null;

    function invalidateXpRecipeByItemCache() {
        xpRecipeByItemCache = null;
    }

    function saveXpRecipe(recipe) {
        const skill = String(recipe?.skill || '').trim().toLowerCase();
        const item = normalizeName(recipe?.item);
        const xp = Number(recipe?.xp || 0);
        const cycle = Number(recipe?.cycle || 0);
        const level = Number(recipe?.level || 0);

        if (!skill || !item || !(xp > 0) || !(cycle > 0)) {
            return false;
        }

        const key = xpRecipeKey(skill, item);
        const existing = state.xpRecipes[key] || {};

        state.xpRecipes[key] = {
            ...existing,
            skill,
            item,
            xp,
            cycle,
            level: level > 0 ? level : Number(existing.level || 0),
            ingredients: Array.isArray(recipe.ingredients)
                ? recipe.ingredients
                : (existing.ingredients || []),
            source: recipe.source || existing.source || 'captured',
            capturedAt: Date.now()
        };

        invalidateXpRecipeByItemCache();

        return true;
    }

    function preloadKnownXpRecipes() {
        BUILT_IN_XP_RECIPES.forEach(recipe => {
            saveXpRecipe({
                ...recipe,
                source: 'built-in'
            });
        });
    }

    function xpRequiredForLevel(level) {
        const value = Math.max(1, Math.floor(Number(level) || 1));
        const earlyLevelXp = {
            1: 25,
            2: 60,
            3: 120
        };

        if (earlyLevelXp[value] !== undefined) {
            return earlyLevelXp[value];
        }

        return 10 * value * value + 30 * value - 80;
    }

    function xpNeededToReachLevel(
        currentLevel,
        currentXp,
        targetLevel
    ) {
        const current = Math.max(1, Math.floor(Number(currentLevel) || 1));
        const target = Math.max(current, Math.floor(Number(targetLevel) || current));
        const progress = Math.max(0, Number(currentXp) || 0);

        if (target <= current) return 0;

        let total = Math.max(0, xpRequiredForLevel(current) - progress);

        for (let level = current + 1; level < target; level += 1) {
            total += xpRequiredForLevel(level);
        }

        return total;
    }

    function projectLevelFromXp(level, currentXp, addedXp) {
        let projectedLevel = Math.max(1, Math.floor(Number(level) || 1));
        let progress = Math.max(0, Number(currentXp) || 0) +
            Math.max(0, Number(addedXp) || 0);

        while (
            projectedLevel < 200 &&
            progress >= xpRequiredForLevel(projectedLevel)
        ) {
            progress -= xpRequiredForLevel(projectedLevel);
            projectedLevel += 1;
        }

        return {
            level: projectedLevel,
            xp: progress,
            required: xpRequiredForLevel(projectedLevel)
        };
    }

    function xpRecipeByItem(itemName) {
        const normalized = normalizeName(itemName).toLowerCase();
        if (!normalized) return null;

        if (!xpRecipeByItemCache) {
            xpRecipeByItemCache = new Map();

            Object.values(state.xpRecipes).forEach(recipe => {
                const key = normalizeName(recipe.item).toLowerCase();

                if (!xpRecipeByItemCache.has(key)) {
                    xpRecipeByItemCache.set(key, recipe);
                }
            });
        }

        return xpRecipeByItemCache.get(normalized) || null;
    }

    function recipeOutputPerAction(recipe) {
        if (!recipe) return 1;

        if (
            recipe.skill === 'logging' ||
            recipe.skill === 'mining' ||
            recipe.skill === 'fishing'
        ) {
            return 1;
        }

        if (/Nails$/i.test(recipe.item)) {
            return 4 * yieldMultiplier('crafting');
        }

        return yieldMultiplier(recipe.skill);
    }

    function expandBaseMaterials(itemName, quantity, depth = 0) {
        const amount = Math.max(0, Number(quantity) || 0);
        if (!(amount > 0) || depth > 8) return {};

        const recipe = xpRecipeByItem(itemName);

        if (!recipe || !Array.isArray(recipe.ingredients) || !recipe.ingredients.length) {
            return { [normalizeName(itemName)]: amount };
        }

        const output = Math.max(0.0001, recipeOutputPerAction(recipe));
        const actions = amount / output;
        const totals = {};

        recipe.ingredients.forEach(ingredient => {
            const required = actions * Number(ingredient.quantity || 0);
            const expanded = expandBaseMaterials(
                ingredient.name,
                required,
                depth + 1
            );

            Object.entries(expanded).forEach(([name, value]) => {
                totals[name] = (totals[name] || 0) + value;
            });
        });

        return totals;
    }

    function groupedSmithingShotName(itemName) {
        const normalized = normalizeName(itemName);
        const match = normalized.match(
            /^(Copper|Iron|Cinder|Darkiron|Mithril|Adamantite|Starmetal|Stormglass|Leviathan|Abyssal)\s+(Round|Chain|Grape)\s+Shot$/i
        );

        if (!match) return '';

        const metal = METALS.find(candidate =>
            candidate.toLowerCase() === match[1].toLowerCase()
        ) || match[1];

        return `${metal} Shot (Round / Chain / Grape)`;
    }

    function collapseSmithingShotXpRows(rows) {
        const groupedRows = new Map();
        const collapsed = [];

        rows.forEach(row => {
            if (row.skill !== 'smithing') {
                collapsed.push(row);
                return;
            }

            const groupedName = groupedSmithingShotName(row.item);

            if (!groupedName) {
                collapsed.push(row);
                return;
            }

            const key = groupedName.toLowerCase();
            const existing = groupedRows.get(key);

            if (existing) {
                existing.shotVariants.push(row.item);
                return;
            }

            const groupedRow = {
                ...row,
                item: groupedName,
                shotVariants: [row.item],
                source: 'grouped-smithing-shot'
            };

            groupedRows.set(key, groupedRow);
            collapsed.push(groupedRow);
        });

        return collapsed;
    }

    function selectedProgressRecipe() {
        const recipes = calculateXpRows().filter(
            recipe => SUPPORTED_XP_SKILLS.includes(recipe.skill)
        );
        const skill = SUPPORTED_XP_SKILLS.includes(state.progressPlanner?.skill)
            ? state.progressPlanner.skill
            : 'smelting';
        const skillRecipes = recipes.filter(recipe => recipe.skill === skill);
        let selected = skillRecipes.find(
            recipe => xpRecipeKey(recipe.skill, recipe.item) ===
                state.progressPlanner?.itemKey
        );

        /*
         * v1.0.20.6 groups Round, Chain, and Grape Shot into one XP Planner
         * action because all three variants use the same bar, level, cycle, and
         * XP for a given metal. Preserve old saved selections by mapping an
         * individual shot key to its new grouped row.
         */
        if (!selected && skill === 'smithing') {
            const savedKey = String(state.progressPlanner?.itemKey || '');
            const prefix = 'smithing:';
            const savedItem = savedKey.toLowerCase().startsWith(prefix)
                ? savedKey.slice(prefix.length)
                : '';
            const groupedName = groupedSmithingShotName(savedItem);

            if (groupedName) {
                selected = skillRecipes.find(recipe =>
                    normalizeName(recipe.item).toLowerCase() ===
                    groupedName.toLowerCase()
                ) || null;
            }
        }

        return selected || skillRecipes[0] || null;
    }

    function calculateProgressPlan() {
        const selectedRecipe = selectedProgressRecipe();

        if (!selectedRecipe) {
            return null;
        }

        const skill = selectedRecipe.skill;
        const detectedLevel = Math.max(
            1,
            Number(state.skillLevels[skill] || selectedRecipe.level || 1)
        );
        const progress = state.skillProgress?.[skill] || {};
        const detectedXp = Math.max(0, Number(progress.currentXp || 0));
        const override = progressPlannerSessionOverrides[skill] || {};
        const currentLevel = Math.max(
            1,
            Math.min(
                200,
                Math.floor(
                    Number(override.currentLevel ?? detectedLevel) ||
                    detectedLevel
                )
            )
        );
        const currentXp = Math.max(
            0,
            Math.min(
                Math.max(0, xpRequiredForLevel(currentLevel) - 1),
                Math.floor(Number(override.currentXp ?? detectedXp) || 0)
            )
        );
        const targetLevel = Math.max(
            currentLevel + 1,
            Math.min(
                200,
                Math.floor(
                    Number(state.progressPlanner?.targetLevel) ||
                    currentLevel + 1
                )
            )
        );
        const allXpRows = calculateXpRows();
        const skillRecipes = allXpRows
            .filter(recipe => recipe.skill === skill)
            .sort((a, b) =>
                Number(a.level || 0) - Number(b.level || 0) ||
                Number(b.xpPerHour || 0) - Number(a.xpPerHour || 0) ||
                String(a.item).localeCompare(String(b.item))
            );
        const bestUnlockedRecipe = level => {
            return [...skillRecipes]
                .filter(recipe => Number(recipe.level || 1) <= level)
                .sort((a, b) =>
                    Number(b.xpPerHour || 0) -
                        Number(a.xpPerHour || 0) ||
                    Number(b.xp || 0) - Number(a.xp || 0) ||
                    String(a.item).localeCompare(String(b.item))
                )[0] || skillRecipes[0] || selectedRecipe;
        };

        const stages = [];
        let simulatedLevel = currentLevel;
        let simulatedXp = currentXp;
        let guard = 0;

        while (simulatedLevel < targetLevel && guard < 100) {
            guard += 1;

            const selectedUnlocked =
                Number(selectedRecipe.level || 1) <= simulatedLevel;
            const stageRecipe = selectedUnlocked
                ? selectedRecipe
                : bestUnlockedRecipe(simulatedLevel);
            let stageTarget = selectedUnlocked
                ? targetLevel
                : Math.min(
                    targetLevel,
                    Number(selectedRecipe.level || targetLevel)
                );

            if (!selectedUnlocked) {
                const nextUnlock = skillRecipes
                    .map(recipe => Number(recipe.level || 1))
                    .filter(level =>
                        level > simulatedLevel && level < stageTarget
                    )
                    .sort((a, b) => a - b)[0];

                if (nextUnlock) {
                    stageTarget = nextUnlock;
                }
            }

            if (stageTarget <= simulatedLevel) {
                stageTarget = Math.min(targetLevel, simulatedLevel + 1);
            }

            const stageXpNeeded = xpNeededToReachLevel(
                simulatedLevel,
                simulatedXp,
                stageTarget
            );
            const stageXp = Math.max(1, Number(stageRecipe.xp || 0));
            const actions = Math.max(1, Math.ceil(stageXpNeeded / stageXp));
            const cycle = adjustedCraftTime(
                stageRecipe.cycle,
                stageRecipe.skill
            );
            const startLevel = simulatedLevel;
            const startXp = simulatedXp;
            const projected = projectLevelFromXp(
                simulatedLevel,
                simulatedXp,
                actions * stageXp
            );
            const directIngredients = (stageRecipe.ingredients || []).map(
                ingredient => ({
                    name: ingredient.name,
                    quantity:
                        actions * Number(ingredient.quantity || 0)
                })
            );

            stages.push({
                recipe: stageRecipe,
                startLevel,
                startXp,
                targetLevel: stageTarget,
                endLevel: Math.min(targetLevel, projected.level),
                endXp: projected.xp,
                xpNeeded: stageXpNeeded,
                actions,
                cycle,
                totalSeconds: actions * cycle,
                directIngredients,
                isSelectedRecipe:
                    xpRecipeKey(stageRecipe.skill, stageRecipe.item) ===
                    xpRecipeKey(
                        selectedRecipe.skill,
                        selectedRecipe.item
                    )
            });

            simulatedLevel = projected.level;
            simulatedXp = projected.xp;
        }

        const mergedStages = [];
        stages.forEach(stage => {
            const previous = mergedStages[mergedStages.length - 1];
            const sameRecipe = previous &&
                xpRecipeKey(previous.recipe.skill, previous.recipe.item) ===
                xpRecipeKey(stage.recipe.skill, stage.recipe.item);

            if (!sameRecipe) {
                mergedStages.push({
                    ...stage,
                    directIngredients: stage.directIngredients.map(
                        ingredient => ({ ...ingredient })
                    )
                });
                return;
            }

            previous.targetLevel = stage.targetLevel;
            previous.endLevel = stage.endLevel;
            previous.endXp = stage.endXp;
            previous.xpNeeded += stage.xpNeeded;
            previous.actions += stage.actions;
            previous.totalSeconds += stage.totalSeconds;
            previous.isSelectedRecipe =
                previous.isSelectedRecipe || stage.isSelectedRecipe;

            stage.directIngredients.forEach(ingredient => {
                const existing = previous.directIngredients.find(item =>
                    normalizeName(item.name).toLowerCase() ===
                    normalizeName(ingredient.name).toLowerCase()
                );

                if (existing) {
                    existing.quantity += ingredient.quantity;
                } else {
                    previous.directIngredients.push({ ...ingredient });
                }
            });
        });

        const directIngredientMap = new Map();
        mergedStages.forEach(stage => {
            stage.directIngredients.forEach(ingredient => {
                const key = normalizeName(ingredient.name).toLowerCase();
                const existing = directIngredientMap.get(key) || {
                    name: normalizeName(ingredient.name),
                    quantity: 0
                };
                existing.quantity += Number(ingredient.quantity || 0);
                directIngredientMap.set(key, existing);
            });
        });
        const directIngredients = [...directIngredientMap.values()];
        const baseMaterials = {};

        directIngredients.forEach(ingredient => {
            const expanded = expandBaseMaterials(
                ingredient.name,
                ingredient.quantity
            );

            Object.entries(expanded).forEach(([name, quantity]) => {
                baseMaterials[name] =
                    (baseMaterials[name] || 0) + quantity;
            });
        });

        const gatheringSkills = new Set([
            'logging',
            'mining',
            'fishing'
        ]);
        const gatheringPlan = directIngredients
            .map(ingredient => {
                const gatheringRecipe = skillRecipes.length
                    ? allXpRows.find(recipe =>
                        gatheringSkills.has(recipe.skill) &&
                        normalizeName(recipe.item).toLowerCase() ===
                        normalizeName(ingredient.name).toLowerCase()
                    )
                    : null;

                if (!gatheringRecipe) return null;

                const yieldPerAction = yieldMultiplier(
                    gatheringRecipe.skill
                );
                const actions = Math.ceil(
                    Number(ingredient.quantity || 0) /
                    Math.max(0.0001, yieldPerAction)
                );
                const cycle = adjustedCraftTime(
                    gatheringRecipe.cycle,
                    gatheringRecipe.skill
                );
                const inputs = (gatheringRecipe.ingredients || []).map(
                    input => ({
                        name: input.name,
                        quantity:
                            actions * Number(input.quantity || 0)
                    })
                );

                return {
                    item: ingredient.name,
                    skill: gatheringRecipe.skill,
                    requiredQuantity: ingredient.quantity,
                    yieldPerAction,
                    actions,
                    cycle,
                    totalSeconds: actions * cycle,
                    inputs
                };
            })
            .filter(Boolean);

        const xpNeeded = xpNeededToReachLevel(
            currentLevel,
            currentXp,
            targetLevel
        );
        const actions = mergedStages.reduce(
            (total, stage) => total + stage.actions,
            0
        );
        const totalSeconds = mergedStages.reduce(
            (total, stage) => total + stage.totalSeconds,
            0
        );
        const gatheringSeconds = gatheringPlan.reduce(
            (total, entry) => total + entry.totalSeconds,
            0
        );
        const combinedSeconds = totalSeconds + gatheringSeconds;
        const selectedUsed = mergedStages.some(stage =>
            stage.isSelectedRecipe
        );

        return {
            recipe: selectedRecipe,
            skill,
            currentLevel,
            currentXp,
            targetLevel,
            xpNeeded,
            actions,
            cycle: adjustedCraftTime(
                selectedRecipe.cycle,
                selectedRecipe.skill
            ),
            totalSeconds,
            gatheringSeconds,
            combinedSeconds,
            directIngredients,
            baseMaterials,
            gatheringPlan,
            stages: mergedStages,
            staged:
                mergedStages.length > 1 ||
                !selectedUsed ||
                Number(selectedRecipe.level || 1) > currentLevel,
            selectedUsed,
            selectedUnlockLevel: Number(selectedRecipe.level || 1)
        };
    }

    function shipBuildXpSummary(result) {
        const woodPlank = xpRecipeByItem(`${result.wood} Plank`);
        const woodBeam = xpRecipeByItem(`${result.wood} Beam`);
        const metalBar = xpRecipeByItem(`${result.metal} Bar`);
        const metalNails = xpRecipeByItem(`${result.metal} Nails`);
        const log = xpRecipeByItem(`${result.wood} Log`);
        const ore = xpRecipeByItem(`${result.metal} Ore`);

        const barsToSmelt = Math.max(
            0,
            result.totalBarsNeeded -
                result.haveBars -
                (result.haveOre * result.smeltingYield / 2)
        );
        const smeltingActions = barsToSmelt /
            Math.max(0.0001, result.smeltingYield);
        const nailActions = result.remainingNails /
            Math.max(0.0001, 4 * result.craftingYield);

        const rows = [
            { skill: 'logging', xp: result.remainingLogs * xpPerActionWithMastery('logging', log?.xp) },
            { skill: 'mining', xp: result.remainingOre * xpPerActionWithMastery('mining', ore?.xp) },
            {
                skill: 'carpentry',
                xp:
                    result.logActions *
                        xpPerActionWithMastery('carpentry', woodPlank?.xp) +
                    result.beamActions *
                        xpPerActionWithMastery('carpentry', woodBeam?.xp)
            },
            { skill: 'smelting', xp: smeltingActions * xpPerActionWithMastery('smelting', metalBar?.xp) },
            { skill: 'crafting', xp: nailActions * xpPerActionWithMastery('crafting', metalNails?.xp) }
        ].filter(row => row.xp > 0);

        return rows.map(row => {
            const currentLevel = Math.max(
                1,
                Number(state.skillLevels[row.skill] || 1)
            );
            const currentXp = Number(
                state.skillProgress?.[row.skill]?.currentXp || 0
            );
            const projected = projectLevelFromXp(
                currentLevel,
                currentXp,
                row.xp
            );

            return {
                ...row,
                currentLevel,
                projected
            };
        });
    }

    function parseDisplayedCycle(text) {
        const source = String(text || '').replace(/\s+/g, ' ');
        const minuteMatch = source.match(/(?:^|\s)(\d+)m(?:\s+(\d+)s)?(?:\s|$)/i);

        if (minuteMatch) {
            return Number(minuteMatch[1]) * 60 +
                Number(minuteMatch[2] || 0);
        }

        const secondMatch = source.match(/(?:^|\s)(\d+(?:\.\d+)?)s(?:\s|$)/i);
        return secondMatch ? Number(secondMatch[1]) : 0;
    }

    function smithingXpRecipeCatalog() {
        const recipes = [];

        METALS.forEach(metal => {
            SHOT_TYPES.forEach(type => {
                recipes.push({
                    item: `${metal} ${type}`,
                    level: Number(SHOT_REQUIRED_LEVELS[metal] || 1),
                    cycle: Number(SHOT_CRAFT_TIMES[metal] || 0),
                    ingredients: [
                        {
                            name: `${metal} Bar`,
                            quantity: 1
                        }
                    ]
                });
            });
        });

        CANNON_RECIPES.forEach(recipe => {
            recipes.push({
                item: recipe.item,
                level: Number(recipe.level || 1),
                cycle: Number(recipe.cycle || 0),
                ingredients: [
                    {
                        name: `${recipe.metal} Bar`,
                        quantity: Number(recipe.bars || 0)
                    },
                    {
                        name: `${recipe.wood} Beam`,
                        quantity: Number(recipe.beams || 0)
                    }
                ]
            });
        });

        return recipes;
    }

    function canonicalSmithingXpRecipe(itemName) {
        const normalized = normalizeName(itemName).toLowerCase();

        if (!normalized) {
            return null;
        }

        return smithingXpRecipeCatalog().find(recipe =>
            recipe.item.toLowerCase() === normalized
        ) || null;
    }

    function smithingXpRecipeFromCardText(cardText) {
        const normalized = normalizeName(cardText).toLowerCase();

        if (!normalized) {
            return null;
        }

        /*
         * Smithing cards contain ingredient labels such as
         * "55x Starmetal Bar" and "17x Madder Beam". The generic title/name
         * selector can accidentally select one of those labels. Match the
         * card against Quartermaster's canonical Smithing recipe names first
         * so the XP is attached to "Starmetal 18-Pounder", not its inputs.
         */
        return smithingXpRecipeCatalog()
            .sort((a, b) => b.item.length - a.item.length)
            .find(recipe =>
                normalized.includes(recipe.item.toLowerCase())
            ) || null;
    }

    function purgeMalformedSmithingXpRecipes() {
        let changed = false;

        Object.entries(state.xpRecipes || {}).forEach(([key, recipe]) => {
            if (
                String(recipe?.skill || '').toLowerCase() !== 'smithing'
            ) {
                return;
            }

            if (!canonicalSmithingXpRecipe(recipe.item)) {
                delete state.xpRecipes[key];
                changed = true;
            }
        });

        if (changed) {
            invalidateXpRecipeByItemCache();
        }

        return changed;
    }

    function scanXpRecipesFromPage() {
        const xpNodes = [...document.querySelectorAll('span, div')]
            .filter(node => {
                if (!(node instanceof HTMLElement)) return false;
                if (node.closest(`#${OVERLAY_ID}`)) return false;

                const text = normalizeName(node.textContent);
                return /^\d[\d,]*\s*XP$/i.test(text);
            });

        let captured = 0;
        const seenCards = new Set();
        let stateChanged = purgeMalformedSmithingXpRecipes();

        xpNodes.forEach(xpNode => {
            let card = xpNode.parentElement;

            for (let depth = 0; card && depth < 6; depth += 1) {
                const text = normalizeName(card.innerText);

                if (
                    /\bLv\.?\s*\d+/i.test(text) &&
                    /\b\d+(?:\.\d+)?s\b|\b\d+m\b/i.test(text)
                ) {
                    break;
                }

                card = card.parentElement;
            }

            if (!(card instanceof HTMLElement) || seenCards.has(card)) {
                return;
            }

            seenCards.add(card);

            const cardText = normalizeName(card.innerText);
            const skillMatch = cardText.match(
                /\b(Logging|Mining|Fishing|Carpentry|Smelting|Cooking|Smithing|Gunnery|Crafting|Navigation)\s*[·•|-]?\s*Lv\.?\s*(\d+)/i
            );

            if (!skillMatch) return;

            const skill = skillMatch[1].toLowerCase();
            const detectedLevel = Number(skillMatch[2] || 0);
            const xp = numberFromText(xpNode.textContent);
            const detectedCycle = parseDisplayedCycle(cardText);
            let item = '';
            let level = detectedLevel;
            let cycle = detectedCycle;
            let ingredients;

            if (skill === 'smithing') {
                const canonical = smithingXpRecipeFromCardText(cardText);

                if (!canonical) {
                    /*
                     * Do not save an ingredient label as a Smithing recipe.
                     * Unknown Smithing cards can be added to the canonical
                     * catalog later without poisoning the XP Planner now.
                     */
                    return;
                }

                item = canonical.item;
                level = canonical.level;
                cycle = canonical.cycle;
                ingredients = canonical.ingredients;
            } else {
                const titleElement = card.querySelector(
                    [
                        'h1',
                        'h2',
                        'h3',
                        'h4',
                        '[class*="title"]',
                        '[class*="name"]'
                    ].join(',')
                );

                item = normalizeName(titleElement?.textContent);

                if (!item) {
                    const lines = String(card.innerText || '')
                        .split('\n')
                        .map(normalizeName)
                        .filter(Boolean);

                    item = lines.find(line =>
                        !/\bXP\b/i.test(line) &&
                        !/\bLv\.?\s*\d+/i.test(line) &&
                        !/^\d+(?:\.\d+)?s$/i.test(line) &&
                        !/^(Cook|Craft|Smelt|Saw|Forge|Make)$/i.test(line)
                    ) || '';
                }
            }

            if (
                saveXpRecipe({
                    skill,
                    item,
                    xp,
                    cycle,
                    level,
                    ingredients,
                    source: 'page'
                })
            ) {
                captured += 1;
                stateChanged = true;
            }
        });

        if (stateChanged) {
            saveState();
        }

        return captured;
    }

    function normalizeXpRecipeForPlanner(recipe) {
        if (!recipe || typeof recipe !== 'object') {
            return null;
        }

        const skill = String(recipe.skill || '').trim().toLowerCase();
        const item = normalizeName(recipe.item);
        const xp = Number(recipe.xp || 0);

        if (!skill || !item || !(xp > 0)) {
            return null;
        }

        /*
         * Smithing now has verified built-in XP data. Keep canonicalization
         * here for backward compatibility with older saved captures so stale
         * ingredient-label parser mistakes can never re-enter the planner.
         */
        if (skill === 'smithing') {
            const canonical = canonicalSmithingXpRecipe(item);

            /*
             * Ignore stale parser mistakes such as "55x Starmetal Bar".
             * Only canonical Smithing outputs belong in the XP Planner.
             */
            if (!canonical) {
                return null;
            }

            return {
                ...recipe,
                skill,
                item: canonical.item,
                xp,
                level: canonical.level,
                cycle: canonical.cycle,
                ingredients: canonical.ingredients,
                source: recipe.source || 'page'
            };
        }

        return {
            ...recipe,
            skill,
            item,
            xp,
            cycle: Number(recipe.cycle || 0),
            level: Number(recipe.level || 0),
            ingredients: Array.isArray(recipe.ingredients)
                ? recipe.ingredients
                : [],
            source: recipe.source || 'captured'
        };
    }

    function calculateXpRows() {
        const recipeMap = new Map();

        BUILT_IN_XP_RECIPES.forEach(recipe => {
            recipeMap.set(
                xpRecipeKey(recipe.skill, recipe.item),
                {
                    ...recipe,
                    source: 'built-in'
                }
            );
        });

        /*
         * Merge any older saved page captures for backward compatibility.
         * Built-in recipes are preloaded into state on startup, so the
         * verified Smithing table remains authoritative.
         */
        Object.values(state.xpRecipes || {}).forEach(recipe => {
            const normalized = normalizeXpRecipeForPlanner(recipe);

            if (!normalized) {
                return;
            }

            const key = xpRecipeKey(
                normalized.skill,
                normalized.item
            );
            const builtIn = recipeMap.get(key);

            /*
             * XP Planner actions must come from the verified built-in catalog.
             * Page captures may refresh known actions, but must never create
             * ingredient-label actions such as "1× Cod" or "55× Starmetal Bar".
             */
            if (!builtIn) {
                return;
            }

            recipeMap.set(key, {
                ...builtIn,
                ...normalized,
                skill: builtIn.skill,
                item: builtIn.item,
                level: builtIn.level,
                ingredients:
                    normalized.ingredients?.length
                        ? normalized.ingredients
                        : (builtIn.ingredients || [])
            });
        });

        const rows = [...recipeMap.values()]
            .map(recipe => {
                const canMake = hasRequiredLevel(
                    recipe.skill,
                    Number(recipe.level || 1)
                );
                const baseXp = Number(recipe.xp || 0);
                const xp = xpPerActionWithMastery(
                    recipe.skill,
                    baseXp
                );
                const adjustedCycle = adjustedCraftTime(
                    recipe.cycle,
                    recipe.skill
                );
                const xpPerHour = adjustedCycle > 0
                    ? xp * 3600 / adjustedCycle
                    : 0;

                return {
                    ...recipe,
                    baseXp,
                    xp,
                    canMake,
                    xpPerHour
                };
            })
            .filter(recipe =>
                SUPPORTED_XP_SKILLS.includes(recipe.skill) &&
                recipe.xp > 0 &&
                recipe.cycle > 0
            );

        return collapseSmithingShotXpRows(rows)
            .sort((a, b) => b.xpPerHour - a.xpPerHour);
    }

    function formatXp(value) {
        const amount = Number(value || 0);
        return amount > 0
            ? `${Math.round(amount).toLocaleString()} XP`
            : '—';
    }

    function formatXpPerHour(value) {
        const amount = Number(value || 0);
        return amount > 0
            ? `${Math.round(amount).toLocaleString()} XP/hr`
            : '—';
    }

    function normalizeMasteryState(savedMastery) {
        const skills = [
            'logging', 'mining', 'fishing', 'carpentry', 'smelting',
            'cooking', 'smithing', 'gunnery', 'crafting', 'navigation'
        ];
        const source = savedMastery || {};
        const normalized = {};

        skills.forEach(skill => {
            const value = source[skill];

            if (value && typeof value === 'object' && !Array.isArray(value)) {
                normalized[skill] = {
                    experience: Math.max(
                        0,
                        Math.min(
                            9,
                            Math.floor(
                                Number(value.experience) ||
                                Number(value.xp) ||
                                0
                            )
                        )
                    ),
                    yield: Math.max(
                        0,
                        Math.min(
                            9,
                            Math.floor(
                                Number(value.yield) ||
                                Number(value.yieldPoints) ||
                                0
                            )
                        )
                    )
                };
                return;
            }

            const oldPercent = Math.max(0, Number(value) || 0);
            normalized[skill] = {
                experience: 0,
                yield: Math.max(
                    0,
                    Math.min(9, Math.round(oldPercent / 20))
                )
            };
        });

        return normalized;
    }

    function masteryTrackPoints(skill, track) {
        const record = state?.mastery?.[skill];

        if (record && typeof record === 'object' && !Array.isArray(record)) {
            return Math.max(
                0,
                Math.min(
                    9,
                    Math.floor(Number(record[track]) || 0)
                )
            );
        }

        if (track === 'yield') {
            return Math.max(
                0,
                Math.min(9, Math.round((Number(record) || 0) / 20))
            );
        }

        return 0;
    }

    function experienceMasteryPoints(skill) {
        return masteryTrackPoints(skill, 'experience');
    }

    function yieldMasteryPoints(skill) {
        return masteryTrackPoints(skill, 'yield');
    }

    function yieldMasteryPercent(skill) {
        return yieldMasteryPoints(skill) * 20;
    }

    function xpPerActionWithMastery(skill, baseXp) {
        return Math.max(
            0,
            Number(baseXp || 0) + experienceMasteryPoints(skill)
        );
    }

    function loadState() {
        try {
            const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
            return {
                ...DEFAULT_STATE,
                ...saved,
                mastery: normalizeMasteryState(
                    saved.mastery || DEFAULT_STATE.mastery
                ),
                skillLevels: {
                    ...DEFAULT_STATE.skillLevels,
                    ...(saved.skillLevels || {})
                },
                inventoryCache: {
                    ...DEFAULT_STATE.inventoryCache,
                    ...(saved.inventoryCache || {}),
                    items: {
                        ...DEFAULT_STATE.inventoryCache.items,
                        ...(saved.inventoryCache?.items || {})
                    },
                    warehouseItems: {
                        ...DEFAULT_STATE.inventoryCache.warehouseItems,
                        ...(saved.inventoryCache?.warehouseItems || {})
                    },
                    cargoItems: {
                        ...DEFAULT_STATE.inventoryCache.cargoItems,
                        ...(saved.inventoryCache?.cargoItems || {})
                    }
                },
                shipBuilder: {
                    ...DEFAULT_STATE.shipBuilder,
                    ...(saved.shipBuilder || {}),
                    inventory: {
                        ...DEFAULT_STATE.shipBuilder.inventory,
                        ...(saved.shipBuilder?.inventory || {})
                    },
                    inventoryPanelPosition: {
                        ...DEFAULT_STATE.shipBuilder.inventoryPanelPosition,
                        ...(saved.shipBuilder?.inventoryPanelPosition || {})
                    }
                },
                craftingPlanner: {
                    ...DEFAULT_STATE.craftingPlanner,
                    ...(saved.craftingPlanner || {}),
                    queue: Array.isArray(saved.craftingPlanner?.queue)
                        ? saved.craftingPlanner.queue
                        : []
                },
                masterySimulator: {
                    ...DEFAULT_STATE.masterySimulator,
                    ...(saved.masterySimulator || {})
                },
                preferences: {
                    ...DEFAULT_STATE.preferences,
                    ...(saved.preferences || {})
                },
                prices: saved.prices || {},
                xpRecipes: saved.xpRecipes || {},
                skillProgress: saved.skillProgress || {},
                progressPlanner: {
                    ...DEFAULT_STATE.progressPlanner,
                    ...(saved.progressPlanner || {})
                },
                vendorDebug: {
                    ...DEFAULT_STATE.vendorDebug,
                    ...(saved.vendorDebug || {})
                },
                netWorthHistory: Array.isArray(saved.netWorthHistory)
                    ? saved.netWorthHistory
                    : [],
                cityInventories:
                    saved.cityInventories &&
                    typeof saved.cityInventories === 'object'
                        ? saved.cityInventories
                        : {}
            };
        } catch {
            return structuredClone(DEFAULT_STATE);
        }
    }

    let state = loadState();
    let progressPlannerSessionOverrides = {};

    if (state.craftingPlanner?.selectedGroup === 'Ammunition') {
        state.craftingPlanner.selectedGroup = 'Smithing';
    }

    if (typeof state.craftingPlanner?.selectedRecipe === 'string') {
        state.craftingPlanner.selectedRecipe =
            state.craftingPlanner.selectedRecipe
                .replace(/^ammo:/, 'smithing:shot:')
                .replace(/^metal:([^:]+):nail$/, 'crafting:nails:$1');
    }

    if (Array.isArray(state.craftingPlanner?.queue)) {
        state.craftingPlanner.queue =
            state.craftingPlanner.queue.map(entry => ({
                ...entry,
                recipeId: String(entry.recipeId || '')
                    .replace(/^ammo:/, 'smithing:shot:')
                    .replace(
                        /^metal:([^:]+):nail$/,
                        'crafting:nails:$1'
                    )
            }));
    }

    /*
     * Parser v1 could mistake Weekly Volume for Unit Price.
     * Clear the old captured market cache once so bad values cannot survive.
     */
    if (
        Number(localStorage.getItem(MARKET_PARSER_VERSION_KEY) || 0) <
        MARKET_PARSER_VERSION
    ) {
        state.prices = {};
        localStorage.setItem(
            MARKET_PARSER_VERSION_KEY,
            String(MARKET_PARSER_VERSION)
        );
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }

    if (!localStorage.getItem(EXCLUDE_DEFAULT_MIGRATION_KEY)) {
        state.excludeLockedCrafts = true;
        localStorage.setItem(EXCLUDE_DEFAULT_MIGRATION_KEY, '1');
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }

    /*
     * Warehouses are per-city, but before city-tracking existed the
     * single-city inventoryCache snapshot was the only record we had.
     * Seed it into cityInventories once so Net Worth doesn't collapse to
     * ship-cargo-only for players updating from an older version.
     */
    if (!localStorage.getItem(CITY_INVENTORY_SEED_MIGRATION_KEY)) {
        if (
            state.currentCity &&
            state.currentCity !== 'None' &&
            !state.cityInventories[state.currentCity] &&
            Object.keys(state.inventoryCache?.warehouseItems || {}).length
        ) {
            state.cityInventories = {
                ...state.cityInventories,
                [state.currentCity]: {
                    items: state.inventoryCache.warehouseItems,
                    updatedAt: Number(state.inventoryCache.updatedAt || Date.now())
                }
            };
        }

        localStorage.setItem(CITY_INVENTORY_SEED_MIGRATION_KEY, '1');
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }

    /*
     * Versions before the warehouse-city detector was scoped to
     * #inv-wh-grid could mislabel a scan under the wrong city (e.g. a
     * remotely-viewed warehouse filed under the docked city). That data
     * can't be trusted, so wipe it once and let it rebuild from clean
     * scans.
     */
    if (!localStorage.getItem(CITY_INVENTORY_RESET_MIGRATION_KEY)) {
        state.cityInventories = {};
        localStorage.setItem(CITY_INVENTORY_RESET_MIGRATION_KEY, '1');
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }

    preloadKnownVendorPrices();
    preloadKnownXpRecipes();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

    function saveState() {
        state.updatedAt = Date.now();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function numberFromText(text) {
        const normalized = String(text || '')
            .replace(/,/g, '')
            .trim();

        const short = normalized.match(/([0-9]+(?:\.[0-9]+)?)\s*([kmb])\b/i);
        if (short) {
            const value = Number(short[1]);
            const mult = short[2].toLowerCase() === 'k'
                ? 1_000
                : short[2].toLowerCase() === 'm'
                    ? 1_000_000
                    : 1_000_000_000;
            return Math.round(value * mult);
        }

        const match = normalized.match(/[0-9]+(?:\.[0-9]+)?/);
        return match ? Number(match[0]) : 0;
    }

    function normalizeName(name) {
        return String(name || '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function netPrice(price) {
        return price * (1 - state.taxPercent / 100);
    }

    function yieldMultiplier(skill) {
        return 1 + yieldMasteryPercent(skill) / 100;
    }

    function citySpeedBonus(skill) {
        return Number(CITY_BONUSES[state.currentCity]?.[skill] || 0);
    }

    function bestCityForSkill(skill) {
        return Object.entries(CITY_BONUSES)
            .map(([city, bonuses]) => ({
                city,
                bonus: Number(bonuses?.[skill] || 0)
            }))
            .sort((a, b) => b.bonus - a.bonus)[0]?.city || 'None';
    }

    function detectCurrentCityFromPage() {
        const knownCities = Object.keys(CITY_BONUSES)
            .filter(city => city !== 'None');

        /*
         * Tidefall exposes the current docked city in the persistent ship
         * context line, for example: "Caelthar Reach · Docked".
         */
        const shipContextLine = document.querySelector('#cs-context-line');
        const shipContextText = normalizeName(
            shipContextLine?.textContent || ''
        );

        if (/\bDocked\b/i.test(shipContextText)) {
            const matchedContextCity = knownCities.find(city =>
                new RegExp(
                    `^${city.replace(/\s+/g, '\\s+')}\\s*·\\s*Docked$`,
                    'i'
                ).test(shipContextText)
            );

            if (matchedContextCity) {
                return matchedContextCity;
            }
        }

        /*
         * Fallback for older Tidefall layouts where the context line was not
         * directly available.
         */
        const activeTaskPanel = document.querySelector('#active-task-panel');
        let shipStatusContainer = activeTaskPanel?.parentElement || null;

        for (let depth = 0; shipStatusContainer && depth < 7; depth += 1) {
            const statusText = normalizeName(shipStatusContainer.innerText);

            if (/\bDOCKED\b/i.test(statusText)) {
                const matchedShipCity = knownCities.find(city =>
                    new RegExp(
                        `\\b${city.replace(/\s+/g, '\\s+')}\\b`,
                        'i'
                    ).test(statusText)
                );

                if (matchedShipCity) {
                    return matchedShipCity;
                }
            }

            shipStatusContainer = shipStatusContainer.parentElement;
        }

        /*
         * Tidefall may also keep the current port name in the left sidebar
         * while docked, even when the city panel is closed.
         */
        const sidebarCityLabel =
            document.querySelector(
                '#city-nav-btn .sidebar-nav-label'
            )?.textContent?.trim() || '';

        if (sidebarCityLabel) {
            const matchedSidebarCity = knownCities.find(city =>
                sidebarCityLabel.localeCompare(
                    city,
                    undefined,
                    { sensitivity: 'accent' }
                ) === 0
            );

            if (matchedSidebarCity) {
                return matchedSidebarCity;
            }
        }

        const urlText = decodeURIComponent(
            `${location.pathname} ${location.search} ${location.hash}`
        ).toLowerCase();

        for (const city of knownCities) {
            const slug = city.toLowerCase().replace(/\s+/g, '-');
            const compact = city.toLowerCase().replace(/\s+/g, '');

            if (urlText.includes(slug) || urlText.includes(compact)) {
                return city;
            }
        }

        const selectors = [
            '[data-current-city]',
            '[data-city-name]',
            '.current-city',
            '.city-name',
            '.port-name',
            '.location-name',
            'main h1',
            'main h2',
            'header h1',
            'header h2'
        ];

        const candidates = Array.from(
            document.querySelectorAll(selectors.join(','))
        ).filter(element =>
            element instanceof HTMLElement &&
            !element.closest(`#${OVERLAY_ID}`) &&
            element.offsetParent !== null
        );

        for (const element of candidates) {
            const value = String(
                element.dataset.currentCity ||
                element.dataset.cityName ||
                element.textContent ||
                ''
            ).trim();

            for (const city of knownCities) {
                if (
                    value.localeCompare(city, undefined, {
                        sensitivity: 'accent'
                    }) === 0 ||
                    new RegExp(`\\b${city.replace(/\s+/g, '\\s+')}\\b`, 'i')
                        .test(value)
                ) {
                    return city;
                }
            }
        }

        return null;
    }

    /*
     * The Warehouse tab has its own city switcher, independent of where the
     * ship is docked (you can browse another city's warehouse remotely).
     * detectCurrentCityFromPage() reflects the docked city and must not be
     * used to label a warehouse scan, or a remotely-viewed city's items get
     * filed under wherever the ship physically is.
     */
    function detectWarehouseCityFromPage() {
        const knownCities = Object.keys(CITY_BONUSES).filter(
            city => city !== 'None'
        );

        /*
         * The game has more than one city-dropdown UI (e.g. one for the
         * Warehouse tab, likely others for Market/Exchange), so a
         * page-wide `.inv-city-dropdown` query can silently latch onto
         * the wrong one and mislabel every scan with whatever city that
         * other dropdown happens to show. Scope everything to the
         * container that actually wraps #inv-wh-grid.
         */
        const warehouseGrid = document.getElementById('inv-wh-grid');
        const container =
            warehouseGrid?.closest('.inv-grid-clip') ||
            warehouseGrid?.parentElement ||
            null;

        if (!container) return null;

        const buttonLabel = normalizeName(
            container.querySelector('.inv-city-dropdown .inv-city-btn span')
                ?.textContent || ''
        );
        const matchedButton = knownCities.find(
            city => city === buttonLabel
        );
        if (matchedButton) return matchedButton;

        /*
         * Fallback while the dropdown listbox itself is open, in case the
         * button label hasn't updated yet.
         */
        const activeOption =
            container.querySelector(
                '.inv-city-menu .inv-city-option--active'
            ) ||
            container.querySelector(
                '.inv-city-menu .inv-city-option[aria-selected="true"]'
            );

        const optionLabel = normalizeName(activeOption?.textContent || '');
        const matchedOption = knownCities.find(
            city => city === optionLabel
        );
        if (matchedOption) return matchedOption;

        /*
         * Last resort: the "Viewing storage from X. Dock there to
         * transfer items." notice shown when browsing a city remotely.
         */
        const noticeText = normalizeName(
            container.querySelector('.inv-undocked-notice')?.textContent ||
                ''
        );
        const matchedNotice = knownCities.find(city =>
            noticeText.includes(`Viewing storage from ${city}`)
        );
        if (matchedNotice) return matchedNotice;

        return null;
    }

    function autoDetectCurrentCity(force = false) {
        if (state.manualCityOverride && !force) {
            return false;
        }

        const detected = detectCurrentCityFromPage();

        if (!detected || detected === state.currentCity) {
            return false;
        }

        state.currentCity = detected;
        saveState();

        const select = document.querySelector(
            '#tqm-header-city-select'
        );

        if (select) {
            select.value = state.manualCityOverride
                ? detected
                : '__auto__';

            const autoOption = select.querySelector(
                'option[value="__auto__"]'
            );

            if (autoOption && !state.manualCityOverride) {
                autoOption.textContent = `Auto Detect · ${detected}`;
            }
        }

        return true;
    }

    function adjustedCraftTime(seconds, skill) {
        return adjustedCraftTimeForCity(
            seconds,
            skill,
            state.currentCity
        );
    }

    function adjustedCraftTimeForCity(seconds, skill, city) {
        const base = Number(seconds) || 0;
        const bonus = Number(CITY_BONUSES[city]?.[skill] || 0);

        return base > 0
            ? base * Math.max(0, 1 - bonus)
            : 0;
    }

    function bestCityResult(buildResult) {
        const candidates = Object.keys(CITY_BONUSES)
            .map(city => ({
                city,
                ...buildResult(city)
            }))
            .filter(result =>
                Number.isFinite(result.goldPerHour)
            )
            .sort((a, b) => b.goldPerHour - a.goldPerHour);

        return candidates[0] || {
            city: 'None',
            goldPerHour: 0,
            seconds: 0
        };
    }

    function portGainPercent(currentValue, bestValue) {
        if (!(currentValue > 0) || !(bestValue > currentValue)) {
            return 0;
        }

        return ((bestValue - currentValue) / currentValue) * 100;
    }

    function goldPerHour(netValue, seconds) {
        return seconds > 0 ? netValue * 3600 / seconds : 0;
    }

    function formatSeconds(seconds) {
        if (!Number.isFinite(seconds) || seconds <= 0) return '—';

        let remaining = Math.round(seconds);

        const days = Math.floor(remaining / 86400);
        remaining %= 86400;

        const hours = Math.floor(remaining / 3600);
        remaining %= 3600;

        const minutes = Math.floor(remaining / 60);
        const secs = remaining % 60;

        const parts = [];

        if (days > 0) parts.push(`${days}d`);
        if (hours > 0) parts.push(`${hours}h`);
        if (minutes > 0) parts.push(`${minutes}m`);
        if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

        return parts.join(' ');
    }

    function formatCycleSeconds(seconds) {
        const total = Number(seconds);
        if (!Number.isFinite(total) || total <= 0) return '—';

        let remaining = Math.round(total * 10) / 10;
        const hours = Math.floor(remaining / 3600);
        remaining -= hours * 3600;
        const minutes = Math.floor(remaining / 60);
        remaining -= minutes * 60;
        const secs = Math.round(remaining * 10) / 10;
        const parts = [];

        if (hours > 0) parts.push(`${hours}h`);
        if (minutes > 0) parts.push(`${minutes}m`);
        if (secs > 0 || parts.length === 0) {
            parts.push(`${secs.toFixed(1)}s`);
        }

        return parts.join(' ');
    }

    function totalMastery(track = null) {
        return MASTERY_SKILLS.reduce((sum, skill) => {
            if (track === 'experience') {
                return sum + experienceMasteryPoints(skill);
            }

            if (track === 'yield') {
                return sum + yieldMasteryPoints(skill);
            }

            return sum +
                experienceMasteryPoints(skill) +
                yieldMasteryPoints(skill);
        }, 0);
    }

    const MASTERY_SKILLS = [
        'logging',
        'mining',
        'fishing',
        'carpentry',
        'smelting',
        'cooking',
        'smithing',
        'gunnery',
        'crafting',
        'navigation'
    ];


    function normalizeSkillName(value) {
        const text = String(value || '').trim().toLowerCase();

        const aliases = {
            craft: 'crafting',
            crafting: 'crafting',
            smith: 'smithing',
            smithing: 'smithing',
            smelt: 'smelting',
            smelting: 'smelting',
            carpenter: 'carpentry',
            carpentry: 'carpentry',
            cook: 'cooking',
            cooking: 'cooking',
            log: 'logging',
            logging: 'logging',
            mine: 'mining',
            mining: 'mining',
            fish: 'fishing',
            fishing: 'fishing',
            gun: 'gunnery',
            gunnery: 'gunnery',
            nav: 'navigation',
            navigation: 'navigation'
        };

        return aliases[text] || null;
    }

    function extractMasteryPercent(text) {
        const source = String(text || '')
            .replace(/\s+/g, ' ')
            .trim();

        const matches = [
            ...source.matchAll(
                /([0-9]{1,3}(?:\.[0-9]+)?)\s*%/g
            )
        ];

        if (!matches.length) return null;

        const scored = matches
            .map(match => {
                const value = Number(match[1]);
                if (
                    !Number.isFinite(value) ||
                    value < 0 ||
                    value > 200
                ) {
                    return null;
                }

                const index = match.index || 0;
                const before = source
                    .slice(Math.max(0, index - 45), index)
                    .toLowerCase();
                const after = source
                    .slice(index, index + match[0].length + 45)
                    .toLowerCase();
                const context = `${before} ${after}`;

                /*
                 * The Mastery screen can show both the current allocation
                 * and the 200% maximum. Never read the maximum as allocated.
                 */
                if (/\b(max|maximum|cap|limit)\b/.test(context)) {
                    return null;
                }

                let score = 0;

                if (/\b(allocated|allocation|current|active|bonus)\b/.test(context)) {
                    score += 20;
                }

                if (/\b(yield|production)\b/.test(context)) {
                    score += 8;
                }

                if (/\+\s*$/.test(before)) {
                    score += 4;
                }

                /*
                 * Earlier, more local percentages are normally the active
                 * allocation; the maximum is usually shown later.
                 */
                score -= index / 1000;

                return { value: Math.round(value), score };
            })
            .filter(Boolean)
            .sort((a, b) => b.score - a.score);

        return scored[0]?.value ?? null;
    }

    function detectSkillFromElement(element) {
        if (!(element instanceof HTMLElement)) return null;

        const directCandidates = [
            element.dataset.skill,
            element.dataset.mastery,
            element.dataset.profession,
            element.getAttribute('data-skill-name'),
            element.getAttribute('aria-label')
        ];

        for (const value of directCandidates) {
            const normalized = normalizeSkillName(value);
            if (normalized) return normalized;
        }

        const text = String(element.innerText || '').toLowerCase();

        return MASTERY_SKILLS.find(skill =>
            new RegExp(`\\b${skill}\\b`, 'i').test(text)
        ) || null;
    }

    function readMasteryTrackPoints(card, track) {
        if (!(card instanceof HTMLElement)) return null;

        const lane = card.querySelector(`.sm-tree-lane--${track}`);
        if (!(lane instanceof HTMLElement)) return null;

        const footer =
            lane.querySelector('.sm-tree-lane__foot') ||
            lane.querySelector('[class*="lane__foot"]');
        const pointMatch = String(footer?.textContent || '')
            .match(/(\d+)\s*\/\s*9\b/);

        if (pointMatch) {
            const points = Number(pointMatch[1]);
            if (Number.isInteger(points) && points >= 0 && points <= 9) {
                return points;
            }
        }

        const bonus = lane.querySelector(
            `.sm-tree-lane__bonus--${track}, .sm-tree-lane__bonus`
        );
        const bonusText = String(bonus?.textContent || '');

        if (track === 'yield') {
            const match = bonusText.match(/\+\s*(\d{1,3})\s*%/);
            if (match) {
                const percent = Number(match[1]);
                if (
                    Number.isFinite(percent) &&
                    percent >= 0 &&
                    percent <= 180 &&
                    percent % 20 === 0
                ) {
                    return percent / 20;
                }
            }
        }

        if (track === 'experience') {
            const match = bonusText.match(/\+\s*(\d{1,2})\s*XP\b/i);
            if (match) {
                const points = Number(match[1]);
                if (Number.isInteger(points) && points >= 0 && points <= 9) {
                    return points;
                }
            }
        }

        return null;
    }

    function scanMasteryFromPage() {
        const cards = [
            ...document.querySelectorAll(
                '.sm-tree-grid__cell[data-skill-key]'
            )
        ];

        if (!cards.length) return 0;

        const found = {};

        cards.forEach(cell => {
            if (!(cell instanceof HTMLElement)) return;

            const skill = normalizeSkillName(cell.dataset.skillKey);
            if (!skill) return;

            const card = cell.querySelector('.sm-tree-card') || cell;
            const experience =
                readMasteryTrackPoints(card, 'experience');
            const yieldPoints =
                readMasteryTrackPoints(card, 'yield');

            if (experience === null && yieldPoints === null) return;

            found[skill] = {
                experience:
                    experience ?? experienceMasteryPoints(skill),
                yield:
                    yieldPoints ?? yieldMasteryPoints(skill)
            };
        });

        const count = Object.keys(found).length;
        if (!count) return 0;

        const nextMastery = {};
        let changed = false;

        MASTERY_SKILLS.forEach(skill => {
            const next = found[skill] || {
                experience: 0,
                yield: 0
            };
            const current = state.mastery?.[skill] || {
                experience: 0,
                yield: 0
            };

            nextMastery[skill] = next;

            if (
                Number(current.experience || 0) !==
                    Number(next.experience || 0) ||
                Number(current.yield || 0) !==
                    Number(next.yield || 0)
            ) {
                changed = true;
            }
        });

        if (changed) {
            MASTERY_SKILLS.forEach(skill => {
                state.mastery[skill] = nextMastery[skill];
            });

            state.masteryUpdatedAt = Date.now();
            saveState();
            updateHeaderMasteryDisplay();
        }

        return count;
    }

    function masteryDisplayText() {
        const active = MASTERY_SKILLS
            .map(skill => {
                const experience =
                    experienceMasteryPoints(skill);
                const yieldPercent =
                    yieldMasteryPercent(skill);
                const bonuses = [];

                if (experience > 0) {
                    bonuses.push(`+${experience} XP`);
                }

                if (yieldPercent > 0) {
                    bonuses.push(`+${yieldPercent}% Yield`);
                }

                return {
                    skill,
                    bonuses
                };
            })
            .filter(item => item.bonuses.length);

        if (!active.length) {
            return 'No mastery detected';
        }

        return active
            .map(item => {
                const name =
                    item.skill[0].toUpperCase() +
                    item.skill.slice(1);

                return `${name} ${item.bonuses.join(' · ')}`;
            })
            .join(' | ');
    }

    function updateHeaderMasteryDisplay() {
        const display = document.querySelector('#tqm-header-mastery-value');
        if (display) {
            display.textContent = masteryDisplayText();
            display.title = state.masteryUpdatedAt
                ? `Last read ${new Date(state.masteryUpdatedAt).toLocaleString()}`
                : 'Open the game Mastery screen once so Quartermaster can read it.';
        }
    }

    function extractSkillLevel(text) {
        const source = String(text || '');
        const patterns = [
            /\bLv\.?\s*([0-9]{1,3})\b/i,
            /\bLevel\s*([0-9]{1,3})\b/i
        ];

        for (const pattern of patterns) {
            const match = source.match(pattern);
            if (!match) continue;

            const value = Number(match[1]);
            if (Number.isFinite(value) && value >= 0 && value <= 200) {
                return Math.round(value);
            }
        }

        return null;
    }

    function scanSkillLevelsFromPage() {
        const cards = [
            ...document.querySelectorAll(
                '.pp-skill-card[data-skill]'
            )
        ];

        if (!cards.length) {
            return 0;
        }

        const found = {};
        const foundProgress = {};

        cards.forEach(card => {
            if (!(card instanceof HTMLElement)) return;

            const skill = String(card.dataset.skill || '')
                .trim()
                .toLowerCase();

            if (!skill || !(skill in state.skillLevels)) {
                return;
            }

            const levelText =
                card.querySelector('.pp-skill-lv')?.textContent ||
                card.textContent ||
                '';

            const level = extractSkillLevel(levelText);

            if (level === null) {
                return;
            }

            found[skill] = level;

            const xpText =
                card.querySelector('.pp-skill-xp')?.textContent ||
                '';

            const xpMatch = String(xpText).match(
                /([\d,]+)\s*\/\s*([\d,]+)\s*XP/i
            );

            if (xpMatch) {
                foundProgress[skill] = {
                    currentXp: numberFromText(xpMatch[1]),
                    requiredXp: numberFromText(xpMatch[2])
                };
            }
        });

        const count = Object.keys(found).length;

        if (!count) {
            return 0;
        }

        let changed = false;

        Object.entries(found).forEach(([skill, level]) => {
            if (Number(state.skillLevels?.[skill] || 0) !== Number(level)) {
                changed = true;
            }
        });

        Object.entries(foundProgress).forEach(([skill, progress]) => {
            const current = state.skillProgress?.[skill] || {};

            if (
                Number(current.currentXp || 0) !==
                    Number(progress.currentXp || 0) ||
                Number(current.requiredXp || 0) !==
                    Number(progress.requiredXp || 0)
            ) {
                changed = true;
            }
        });

        if (changed) {
            Object.entries(found).forEach(([skill, level]) => {
                state.skillLevels[skill] = level;
            });

            Object.entries(foundProgress).forEach(([skill, progress]) => {
                state.skillProgress[skill] = {
                    ...progress,
                    updatedAt: Date.now()
                };
            });

            saveState();
        }

        return count;
    }

    function hasRequiredLevel(skill, requiredLevel) {
        if (!state.excludeLockedCrafts) return true;

        const rawLevel = state.skillLevels[skill];
        const level = Number(rawLevel);

        /*
         * Unknown or undetected levels must not hide every craft.
         * Only apply the filter after a real level has been detected.
         */
        if (!Number.isFinite(level) || level <= 0) {
            return true;
        }

        return level >= requiredLevel;
    }

    function skillLevelStatus(skill) {
        const level = Number(state.skillLevels[skill]);

        if (!Number.isFinite(level) || level <= 0) {
            return {
                known: false,
                label: 'Not Detected'
            };
        }

        return {
            known: true,
            label: `Lv. ${level}`
        };
    }


    function moneyPerHour(value) {
        return value > 0
            ? `${Math.round(value).toLocaleString()} g/hr`
            : '—';
    }

    function signedMoney(value) {
        if (!Number.isFinite(value)) return '—';

        const rounded = Math.round(value);
        const sign = rounded > 0 ? '+' : '';

        return `${sign}${rounded.toLocaleString()}g`;
    }

    function signedMoneyPerHour(value) {
        if (!Number.isFinite(value)) return '—';

        const rounded = Math.round(value);
        const sign = rounded > 0 ? '+' : '';

        return `${sign}${rounded.toLocaleString()} g/hr`;
    }

    function portRecommendation(bestPort, skill) {
        if (bestPort?.city && bestPort.city !== 'None') {
            return bestPort.city;
        }

        return bestCityForSkill(skill);
    }

    function findTextValue(root, labels) {
        const text = root?.innerText || '';
        for (const label of labels) {
            const expression = new RegExp(
                label + String.raw`[\s:\n]*([0-9][0-9,]*(?:\.[0-9]+)?(?:\s*[kmb])?)`,
                'i'
            );
            const match = text.match(expression);
            if (match) return numberFromText(match[1]);
        }
        return 0;
    }

    function detectItemName(row) {
        const selectors = [
            '.mkt-item-name',
            '.mkt-name',
            '.item-name',
            '[data-item-name]',
            'td:nth-child(2)',
            'td:first-child'
        ];

        for (const selector of selectors) {
            const element = row.querySelector(selector);
            const value = element?.dataset?.itemName || element?.textContent;
            const name = normalizeName(value);
            if (name && !/^[0-9,.]+$/.test(name)) return name;
        }

        const image = row.querySelector('img[alt]');
        if (image?.alt) return normalizeName(image.alt);

        const lines = String(row.innerText || '')
            .split('\n')
            .map(normalizeName)
            .filter(Boolean);

        return lines.find(line =>
            /log|plank|beam|ore|bar|nail|kit|cannon|shot|ration|stew|salmon|tuna|swordfish|shark|fillet|feast/i.test(line)
        ) || '';
    }

    function directRowCells(row) {
        const tableCells = Array.from(row.querySelectorAll(':scope > td'));

        if (tableCells.length) {
            return tableCells;
        }

        return Array.from(row.children)
            .filter(element =>
                element instanceof HTMLElement &&
                !element.matches('script, style')
            );
    }

    function normalizeHeaderLabel(value) {
        return String(value || '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    function findMarketHeaderCells(row) {
        const table = row.closest('table');

        if (table) {
            const headerRow =
                table.querySelector('thead tr') ||
                Array.from(table.querySelectorAll('tr')).find(candidate =>
                    /best ask|best bid|weekly volume/i.test(candidate.innerText || '')
                );

            if (headerRow) {
                return Array.from(
                    headerRow.querySelectorAll(':scope > th, :scope > td')
                );
            }
        }

        let container = row.parentElement;

        for (let depth = 0; container && depth < 4; depth += 1) {
            const candidates = Array.from(container.children);

            const header = candidates.find(candidate => {
                if (!(candidate instanceof HTMLElement) || candidate === row) {
                    return false;
                }

                const value = candidate.innerText || '';

                return (
                    /best ask/i.test(value) &&
                    /best bid/i.test(value) &&
                    /weekly volume/i.test(value)
                );
            });

            if (header) {
                const cells = Array.from(header.children)
                    .filter(element => element instanceof HTMLElement);

                return cells.length ? cells : [header];
            }

            container = container.parentElement;
        }

        return [];
    }

    function buildMarketColumnMap(row) {
        const headers = findMarketHeaderCells(row);
        const map = {};

        headers.forEach((header, index) => {
            const label = normalizeHeaderLabel(header.innerText);

            if (label.includes('item')) map.item = index;
            if (label.includes('best ask')) map.ask = index;
            if (label.includes('best bid')) map.bid = index;
            if (label.includes('spread')) map.spread = index;
            if (label.includes('weekly volume')) map.weeklyVolume = index;
            if (label.includes('weekly trend')) map.weeklyTrend = index;
            if (label.includes('local status')) map.localStatus = index;
        });

        return map;
    }

    function marketNumberFromCell(cell) {
        if (!(cell instanceof HTMLElement)) return 0;

        const text = String(cell.innerText || cell.textContent || '').trim();

        if (!text || /^[—–-]+$/.test(text)) {
            return 0;
        }

        return numberFromText(text);
    }

    function parseMarketSummaryRow(row) {
        const cells = directRowCells(row);

        if (cells.length < 5) {
            return null;
        }

        const map = buildMarketColumnMap(row);
        const hasMappedSummaryColumns =
            Number.isInteger(map.ask) ||
            Number.isInteger(map.bid) ||
            Number.isInteger(map.weeklyVolume);

        /*
         * Tidefall's Exchange summary grid currently uses:
         * Item, Best Ask, Best Bid, Spread, Weekly Volume,
         * Weekly Trend, Local Status.
         *
         * Only use this positional fallback when the row visibly resembles
         * that summary grid. This prevents listing quantity/total/time rows
         * from being treated as market-price rows.
         */
        const lastCell = cells.length ? cells[cells.length - 1] : null;
        const statusText = String(lastCell?.innerText || '');
        const looksLikeSummaryGrid =
            cells.length >= 7 &&
            /abundant|high supply|low supply|stable/i.test(statusText);

        if (!hasMappedSummaryColumns && !looksLikeSummaryGrid) {
            return null;
        }

        const indexes = {
            item: Number.isInteger(map.item) ? map.item : 0,
            ask: Number.isInteger(map.ask) ? map.ask : 1,
            bid: Number.isInteger(map.bid) ? map.bid : 2,
            spread: Number.isInteger(map.spread) ? map.spread : 3,
            weeklyVolume:
                Number.isInteger(map.weeklyVolume) ? map.weeklyVolume : 4
        };

        const name =
            detectItemName(cells[indexes.item] || row) ||
            detectItemName(row);

        if (!name) {
            return null;
        }

        return {
            name,
            ask: marketNumberFromCell(cells[indexes.ask]),
            bid: marketNumberFromCell(cells[indexes.bid]),
            spread: marketNumberFromCell(cells[indexes.spread]),
            weeklyVolume: marketNumberFromCell(cells[indexes.weeklyVolume])
        };
    }

    function detectItemId(row) {
        if (!(row instanceof HTMLElement)) return null;

        const idElement =
            row.matches('[data-mkt-item-type-id]')
                ? row
                : row.querySelector('[data-mkt-item-type-id]');

        const raw =
            idElement?.getAttribute('data-mkt-item-type-id') ||
            row.dataset.mktItemTypeId ||
            row.dataset.mktItem ||
            row.dataset.itemId ||
            row.dataset.item ||
            '';

        const value = Number(raw);
        return Number.isFinite(value) && value > 0
            ? value
            : null;
    }

    function scanVisibleExchange({
        includeVendorDetail = true
    } = {}) {
        let captured = 0;

        const rows = document.querySelectorAll(
            [
                'tr.mkt-row[data-mkt-item]',
                'tr.mkt-row',
                '[data-mkt-item]',
                '.mkt-row'
            ].join(',')
        );

        const seenRows = new Set();

        rows.forEach(row => {
            if (!(row instanceof HTMLElement) || seenRows.has(row)) return;
            seenRows.add(row);

            const parsed = parseMarketSummaryRow(row);
            if (!parsed) return;

            const existing = state.prices[parsed.name] || {};

            state.prices[parsed.name] = {
                ...existing,
                id: detectItemId(row) ?? existing.id ?? null,
                name: parsed.name,

                /*
                 * Store zero when the Exchange displays a dash.
                 * Do not retain an obsolete or corrupted cached ask/bid.
                 */
                ask: parsed.ask,
                bid: parsed.bid,
                spread: parsed.spread,
                weeklyVolume: parsed.weeklyVolume,

                source:
                    Number(existing.vendorPrice || 0) > 0
                        ? 'exchange-summary+vendor'
                        : 'exchange-summary',
                capturedAt: Date.now()
            };

            propagateShotMarketRecord(
                parsed.name,
                state.prices[parsed.name]
            );

            captured += 1;
        });

        if (includeVendorDetail) {
            scanOpenItemDetail();
        }

        saveState();

        return captured;
    }

    function exactTextElements(root, wanted) {
        const target = normalizeName(wanted).toLowerCase();

        return [...(root || document).querySelectorAll('*')]
            .filter(element =>
                element instanceof HTMLElement &&
                normalizeName(element.textContent).toLowerCase() === target
            );
    }

    function detailValueByLabel(root, label) {
        const labelElement = exactTextElements(root, label)[0];
        if (!labelElement) return 0;

        for (
            let container = labelElement.parentElement, depth = 0;
            container && depth < 4;
            container = container.parentElement, depth += 1
        ) {
            const children = [...container.children]
                .filter(child => child instanceof HTMLElement);
            const labelIndex = children.indexOf(labelElement);

            if (labelIndex >= 0) {
                for (let index = labelIndex + 1; index < children.length; index += 1) {
                    const value = numberFromText(children[index].innerText);
                    if (value > 0) return value;
                }
            }

            const values = [...container.querySelectorAll(
                '.mkt-detail-stats-val, [class*="value"], strong'
            )]
                .map(element => numberFromText(element.textContent))
                .filter(value => value > 0);

            if (values.length) return values[0];
        }

        return 0;
    }

    function closestMarketSection(element, requiredText) {
        let container = element?.parentElement || null;

        for (let depth = 0; container && depth < 8; depth += 1) {
            const text = normalizeName(container.innerText).toLowerCase();

            if (
                text.includes(requiredText.toLowerCase()) &&
                (
                    container.matches(
                        'section, article, table, [class*="market"], [class*="depth"], [class*="trade"]'
                    ) ||
                    depth >= 3
                )
            ) {
                return container;
            }

            container = container.parentElement;
        }

        return null;
    }

    function directVisibleChildren(element) {
        return [...(element?.children || [])]
            .filter(child =>
                child instanceof HTMLElement &&
                child.offsetParent !== null &&
                normalizeName(child.innerText)
            );
    }

    function marketDepthLevels(root, side) {
        const normalizedSide = String(side || '').toUpperCase();
        const bookSide = normalizedSide === 'SELLER' || normalizedSide === 'ASK'
            ? 'ask'
            : normalizedSide === 'BUYER' || normalizedSide === 'BID'
                ? 'bid'
                : '';

        /*
         * Tidefall exposes the reliable order-book values directly on each
         * row. Prefer these attributes over reading formatted cell text.
         * Example:
         * data-mkt-book-side="ask"
         * data-mkt-book-price="14"
         * data-mkt-book-qty="866"
         */
        if (root && bookSide) {
            const attributeLevels = [...root.querySelectorAll(
                `[data-mkt-book-side="${bookSide}"]`
            )]
                .map(row => {
                    const price = Number(
                        row.getAttribute('data-mkt-book-price') || 0
                    );
                    const quantity = Number(
                        row.getAttribute('data-mkt-book-qty') || 0
                    );
                    const cells = directVisibleChildren(row);

                    return {
                        price,
                        quantity,
                        party: normalizeName(cells[0]?.innerText),
                        location: normalizeName(cells[1]?.innerText)
                    };
                })
                .filter(level =>
                    Number.isFinite(level.price) && level.price > 0 &&
                    Number.isFinite(level.quantity) && level.quantity > 0
                );

            if (attributeLevels.length) {
                const merged = new Map();

                attributeLevels.forEach(level => {
                    const key = Number(level.price).toFixed(6);
                    const existing = merged.get(key) || {
                        price: Number(level.price),
                        quantity: 0,
                        orders: 0
                    };

                    existing.quantity += Number(level.quantity || 0);
                    existing.orders += 1;
                    merged.set(key, existing);
                });

                return [...merged.values()].sort((a, b) =>
                    bookSide === 'ask'
                        ? a.price - b.price
                        : b.price - a.price
                );
            }
        }

        const sideLabel = exactTextElements(root, normalizedSide)[0];
        if (!sideLabel) return [];

        const section = closestMarketSection(
            sideLabel,
            normalizedSide === 'SELLER' ? 'buyer' : 'seller'
        ) || root;

        const opposite = exactTextElements(
            section,
            normalizedSide === 'SELLER' ? 'BUYER' : 'SELLER'
        )[0];

        const candidates = [...section.querySelectorAll(
            'tr, [role="row"], [class*="row"]'
        )]
            .filter(row => {
                if (!(row instanceof HTMLElement) || row === sideLabel) {
                    return false;
                }

                const relationToLabel =
                    sideLabel.compareDocumentPosition(row);
                const comesAfter = Boolean(
                    relationToLabel & Node.DOCUMENT_POSITION_FOLLOWING
                );

                if (!comesAfter) return false;

                if (opposite) {
                    const relationToOpposite =
                        row.compareDocumentPosition(opposite);
                    const comesBeforeOpposite = Boolean(
                        relationToOpposite &
                        Node.DOCUMENT_POSITION_FOLLOWING
                    );

                    if (!comesBeforeOpposite) return false;
                }

                const cells = directVisibleChildren(row);
                return cells.length >= 3 && cells.length <= 6;
            });

        const rawLevels = [];

        candidates.forEach(row => {
            const cells = directVisibleChildren(row);
            const values = cells.map(cell => normalizeName(cell.innerText));
            const joined = values.join(' ').toLowerCase();

            if (
                /\b(?:seller|buyer)\b/.test(joined) &&
                /\bprice\b/.test(joined) &&
                /\bqty|quantity\b/.test(joined)
            ) {
                return;
            }

            let price = numberFromText(values[2]);
            let quantity = numberFromText(values[3]);

            if (!(price > 0) || !(quantity > 0)) {
                const numericValues = values
                    .slice(1)
                    .map(value => numberFromText(value))
                    .filter(value => value > 0);

                if (numericValues.length >= 2) {
                    price = numericValues[numericValues.length - 2];
                    quantity = numericValues[numericValues.length - 1];
                }
            }

            if (!(price > 0) || !(quantity > 0)) return;

            rawLevels.push({
                price,
                quantity,
                party: values[0] || '',
                location: values[1] || ''
            });
        });

        const merged = new Map();

        rawLevels.forEach(level => {
            const key = Number(level.price).toFixed(6);
            const existing = merged.get(key) || {
                price: Number(level.price),
                quantity: 0,
                orders: 0
            };

            existing.quantity += Number(level.quantity || 0);
            existing.orders += 1;
            merged.set(key, existing);
        });

        return [...merged.values()].sort((a, b) =>
            normalizedSide === 'SELLER'
                ? a.price - b.price
                : b.price - a.price
        );
    }

    function marketDepthSideSnapshot(root, side) {
        const normalizedSide = String(side || '').toUpperCase();
        const levels = marketDepthLevels(root, normalizedSide);
        const textRoot = root instanceof Document ? root.body : root;
        const text = normalizeName(
            textRoot?.innerText || textRoot?.textContent
        ).toLowerCase();
        const emptyPhrases = normalizedSide === 'SELLER'
            ? [
                'no sell orders',
                'no seller orders',
                'no asks'
            ]
            : [
                'no buy orders',
                'no buyer orders',
                'no bids'
            ];
        const explicitlyEmpty = emptyPhrases.some(phrase =>
            text.includes(phrase)
        );

        return {
            levels,
            explicitlyEmpty,
            observed: levels.length > 0 || explicitlyEmpty
        };
    }

    function depthPriceFromSide(root, side) {
        return Number(marketDepthLevels(root, side)[0]?.price || 0);
    }

    function recentTradeMedian(root, maximumRows = 5) {
        const heading = exactTextElements(root, 'RECENT TRADES')[0];
        if (!heading) return 0;

        const section = closestMarketSection(heading, 'price') || root;
        const prices = [...section.querySelectorAll(
            'tr, [role="row"], [class*="row"]'
        )]
            .map(row => directVisibleChildren(row))
            .filter(cells => cells.length >= 3 && cells.length <= 6)
            .map(cells => {
                const texts = cells.map(cell => normalizeName(cell.innerText));
                const timeLike = /^(?:\d+\s*[smhd]|today|yesterday)$/i.test(
                    texts[0] || ''
                );

                if (!timeLike) return 0;

                return numberFromText(texts[1]);
            })
            .filter(value => value > 0)
            .slice(0, maximumRows);

        if (!prices.length) return 0;

        const sorted = [...prices].sort((a, b) => a - b);
        const middle = Math.floor(sorted.length / 2);

        return sorted.length % 2
            ? sorted[middle]
            : (sorted[middle - 1] + sorted[middle]) / 2;
    }

    function marketDetailCaptureRoot(startElement) {
        let container = startElement instanceof HTMLElement
            ? startElement
            : null;

        /*
         * The item stats and order book are in separate left/right columns.
         * Climb until both columns are inside the same ancestor so the depth
         * rows can be read from the currently open item detail.
         */
        for (let depth = 0; container && depth < 16; depth += 1) {
            if (
                container.querySelector(
                    [
                        '.mkt-detail-book-table',
                        'td.mkt-empty',
                        '[data-mkt-book-side="ask"]',
                        '[data-mkt-book-side="bid"]'
                    ].join(',')
                )
            ) {
                return container;
            }

            container = container.parentElement;
        }

        return document;
    }

    function scanOpenItemDetail() {
        const vendorCells = [...document.querySelectorAll(
            '.mkt-detail-stats-cell'
        )];

        const vendorCell = vendorCells.find(cell =>
            normalizeName(
                cell.querySelector('.mkt-detail-stats-label')?.textContent
            ).toLowerCase() === 'vendor price'
        );

        if (!vendorCell) {
            state.vendorDebug = {
                status: 'Vendor Price field not found',
                itemId: null,
                itemName: '',
                rawText: '',
                parsedPrice: 0,
                saved: false,
                scannedAt: Date.now()
            };
            return false;
        }

        const statsRoot =
            vendorCell.closest('.mkt-detail-stats') ||
            vendorCell.parentElement;

        const itemIdElement =
            statsRoot?.querySelector('[data-mkt-item-type-id]') ||
            document.querySelector(
                '.mkt-detail-stats [data-mkt-item-type-id]'
            );

        const itemId = Number(
            itemIdElement?.getAttribute('data-mkt-item-type-id') || 0
        );

        const recordById = itemId > 0
            ? Object.values(state.prices).find(
                record => Number(record?.id || 0) === itemId
            )
            : null;

        const linkedSummaryElement = itemId > 0
            ? document.querySelector(
                `[data-mkt-item-type-id="${itemId}"]`
            )
            : null;

        const linkedSummaryRow =
            linkedSummaryElement?.closest(
                'tr.mkt-row, [data-mkt-item], .mkt-row'
            );

        const detailContainer =
            statsRoot?.closest(
                '.mkt-detail-panel, #mkt-detail, [class*="mkt-detail"]'
            ) ||
            statsRoot?.parentElement;

        const itemName =
            normalizeName(
                detailContainer?.querySelector(
                    [
                        '.mkt-detail-title',
                        '.mkt-item-name',
                        '[data-mkt-detail-title]',
                        '.mkt-detail-header h1',
                        '.mkt-detail-header h2',
                        '.mkt-detail-header h3',
                        'h1',
                        'h2',
                        'h3'
                    ].join(',')
                )?.textContent
            ) ||
            normalizeName(
                detailContainer?.querySelector('img[alt]')?.alt
            ) ||
            detectItemName(linkedSummaryRow) ||
            normalizeName(recordById?.name);

        const rawText = normalizeName(
            vendorCell.querySelector('.mkt-detail-stats-val')?.textContent
        );

        const marketDetailRoot = marketDetailCaptureRoot(statsRoot);
        const vendorPrice = numberFromText(rawText);
        const sellerSnapshot = marketDepthSideSnapshot(
            marketDetailRoot,
            'SELLER'
        );
        const buyerSnapshot = marketDepthSideSnapshot(
            marketDetailRoot,
            'BUYER'
        );
        const sellerDepth = sellerSnapshot.levels;
        const buyerDepth = buyerSnapshot.levels;
        const estimatedAsk = sellerSnapshot.explicitlyEmpty
            ? 0
            : (
                detailValueByLabel(detailContainer, 'ESTIMATED ASK') ||
                detailValueByLabel(marketDetailRoot, 'ESTIMATED ASK') ||
                Number(sellerDepth[0]?.price || 0)
            );
        const highestBid = buyerSnapshot.explicitlyEmpty
            ? 0
            : Number(buyerDepth[0]?.price || 0);
        const tradeMedian =
            recentTradeMedian(marketDetailRoot, 5);

        if (!itemName) {
            state.vendorDebug = {
                status: 'Price found, item could not be identified',
                itemId: itemId || null,
                itemName: '',
                rawText,
                parsedPrice: vendorPrice || 0,
                saved: false,
                scannedAt: Date.now()
            };
            return false;
        }

        if (!(vendorPrice > 0)) {
            state.vendorDebug = {
                status: 'Item found, vendor price could not be parsed',
                itemId: itemId || null,
                itemName,
                rawText,
                parsedPrice: 0,
                saved: false,
                scannedAt: Date.now()
            };
            return false;
        }

        const existing =
            state.prices[itemName] ||
            recordById ||
            {
                name: itemName,
                ask: 0,
                bid: 0,
                spread: 0,
                weeklyVolume: 0,
                lastSold: 0
            };

        state.prices[itemName] = {
            ...existing,
            id: itemId || existing.id || null,
            name: itemName,
            ask: sellerSnapshot.observed
                ? Number(estimatedAsk || 0)
                : Number(existing.ask || 0),
            bid: buyerSnapshot.observed
                ? Number(highestBid || 0)
                : Number(existing.bid || 0),
            lastSold: tradeMedian > 0
                ? tradeMedian
                : Number(existing.lastSold || 0),
            recentTradeMedian: tradeMedian > 0
                ? tradeMedian
                : Number(
                    existing.recentTradeMedian ||
                    existing.lastSold ||
                    0
                ),
            vendorPrice,
            askDepth: sellerSnapshot.observed
                ? sellerDepth
                : (existing.askDepth || []),
            bidDepth: buyerSnapshot.observed
                ? buyerDepth
                : (existing.bidDepth || []),
            askQuantity: sellerSnapshot.observed
                ? Number(sellerDepth[0]?.quantity || 0)
                : Number(existing.askQuantity || 0),
            bidQuantity: buyerSnapshot.observed
                ? Number(buyerDepth[0]?.quantity || 0)
                : Number(existing.bidQuantity || 0),
            depthCapturedAt:
                sellerSnapshot.observed || buyerSnapshot.observed
                    ? Date.now()
                    : Number(existing.depthCapturedAt || 0),
            source: 'exchange-detail-market+vendor',
            capturedAt: Date.now()
        };

        const shotPricePropagated = propagateShotVendorPrice(
            itemName,
            vendorPrice
        );

        propagateShotMarketRecord(
            itemName,
            state.prices[itemName]
        );

        state.vendorDebug = {
            status: shotPricePropagated
                ? 'Market prices saved; vendor copied to all shot types'
                : `Market detail saved: ask ${
                    sellerSnapshot.explicitlyEmpty
                        ? 'none'
                        : (estimatedAsk || '—')
                } (${Number(sellerDepth[0]?.quantity || 0).toLocaleString()} available), bid ${
                    buyerSnapshot.explicitlyEmpty
                        ? 'none'
                        : (highestBid || '—')
                } (${Number(buyerDepth[0]?.quantity || 0).toLocaleString()} wanted), recent median ${
                    tradeMedian || '—'
                }`,
            itemId: itemId || null,
            itemName,
            rawText,
            parsedPrice: vendorPrice,
            saved: true,
            scannedAt: Date.now()
        };

        return true;
    }

    function findItemPrice(possibleNames) {
        for (const name of possibleNames) {
            const exact = state.prices[name];
            if (exact) return exact;

            const key = Object.keys(state.prices).find(itemName =>
                itemName.toLowerCase() === name.toLowerCase()
            );
            if (key) return state.prices[key];
        }
        return null;
    }

    const THIN_MARKET_OUTLIER_MULTIPLIER = 5;

    function analyzeMarketPrice(record) {
        if (!record) {
            return {
                price: 0,
                source: 'None',
                askRejected: false,
                bidIgnored: false,
                reference: 0
            };
        }

        const ask = Number(record.ask || 0);
        const lastSold = Number(record.lastSold || 0);
        const bid = Number(record.bid || 0);
        const vendorPrice = Number(record.vendorPrice || 0);

        /*
         * Exchange profit calculations require a live active sell listing.
         * Last Sold, buy orders, and vendor values are reference data only.
         */
        const references = [bid, lastSold, vendorPrice]
            .filter(value => Number.isFinite(value) && value > 0);
        const reference = references.length
            ? Math.max(...references)
            : 0;
        const askRejected =
            ask > 0 &&
            reference > 0 &&
            ask > reference * THIN_MARKET_OUTLIER_MULTIPLIER;

        if (ask > 0 && !askRejected) {
            return {
                price: ask,
                source: 'Exchange Listing',
                askRejected: false,
                bidIgnored: bid > 0,
                reference
            };
        }

        return {
            price: 0,
            source: 'None',
            askRejected,
            bidIgnored: bid > 0,
            reference
        };
    }

    function chosenMarketPrice(record) {
        return analyzeMarketPrice(record).price;
    }

    function normalizedDepthLevels(record, side) {
        const key = side === 'bid' ? 'bidDepth' : 'askDepth';
        const levels = Array.isArray(record?.[key])
            ? record[key]
            : [];

        return levels
            .map(level => ({
                price: Number(level?.price || 0),
                quantity: Number(level?.quantity || 0)
            }))
            .filter(level => level.price > 0 && level.quantity > 0)
            .sort((a, b) =>
                side === 'bid'
                    ? b.price - a.price
                    : a.price - b.price
            );
    }

    function executeMarketDepth(record, side, quantity) {
        const requested = Math.max(0, Number(quantity) || 0);
        const levels = normalizedDepthLevels(record, side);
        let remaining = requested;
        let total = 0;
        let filled = 0;
        let levelsUsed = 0;
        const fills = [];

        for (const level of levels) {
            if (!(remaining > 0)) break;

            const amount = Math.min(remaining, level.quantity);
            if (!(amount > 0)) continue;

            total += amount * level.price;
            filled += amount;
            remaining -= amount;
            levelsUsed += 1;
            fills.push({
                price: level.price,
                quantity: amount
            });
        }

        return {
            known: levels.length > 0,
            requested,
            filled,
            unfilled: Math.max(0, remaining),
            complete: requested <= 0 || remaining <= 0.000001,
            total,
            averagePrice: filled > 0 ? total / filled : 0,
            bestPrice: Number(levels[0]?.price || 0),
            bestPriceQuantity: Number(levels[0]?.quantity || 0),
            totalAvailable: levels.reduce(
                (sum, level) => sum + level.quantity,
                0
            ),
            levelsUsed,
            fills
        };
    }

    function exchangeBuyCost(record, quantity = 1) {
        const count = Math.max(0, Number(quantity) || 0);
        const marketAnalysis = analyzeMarketPrice(record);
        const marketPrice = marketAnalysis.price;
        const depth = executeMarketDepth(record, 'ask', count);
        const hasUsableDepth = depth.known && depth.complete;
        const value = hasUsableDepth
            ? depth.total
            : depth.known && !depth.complete
                ? NaN
                : marketPrice > 0
                    ? marketPrice * count
                    : NaN;

        return {
            value,
            source: Number.isFinite(value) && value > 0
                ? 'Exchange Listing'
                : 'Unavailable',
            marketPrice,
            averagePrice: hasUsableDepth
                ? depth.averagePrice
                : marketPrice,
            marketSource: marketAnalysis.source,
            askRejected: marketAnalysis.askRejected,
            bidIgnored: marketAnalysis.bidIgnored,
            depthKnown: depth.known,
            depthComplete: depth.complete,
            availableAtBestPrice: depth.known
                ? depth.bestPriceQuantity
                : Number(record?.askQuantity || 0),
            totalAvailable: depth.known
                ? depth.totalAvailable
                : 0,
            levelsUsed: depth.levelsUsed,
            requestedQuantity: count
        };
    }

    function resolveCraftInputCost(record, quantity = 1) {
        const count = Math.max(0, Number(quantity) || 0);
        const purchase = exchangeBuyCost(record, count);

        if (Number.isFinite(purchase.value) && purchase.value > 0) {
            return {
                ...purchase,
                source: 'Exchange Listing'
            };
        }

        const opportunity = bestAvailableSaleValue(record, count);

        if (
            Number.isFinite(opportunity.value) &&
            opportunity.value > 0
        ) {
            return {
                value: opportunity.value,
                source: opportunity.source,
                marketPrice: opportunity.marketPrice || 0,
                vendorPrice: opportunity.vendorPrice || 0,
                recentTradeMedian:
                    opportunity.recentTradeMedian || 0,
                fallback: true
            };
        }

        return {
            value: NaN,
            source: 'Unavailable',
            marketPrice: 0,
            vendorPrice: 0,
            recentTradeMedian: 0,
            fallback: true
        };
    }

    function analyzeImmediateSale(record) {
        if (!record) {
            return {
                netUnitValue: 0,
                source: 'Unavailable',
                ask: 0,
                bid: 0,
                vendorPrice: 0,
                recentTradeMedian: 0
            };
        }

        const marketAnalysis = analyzeMarketPrice(record);
        const ask = Number(marketAnalysis.price || 0);
        const bid = Number(record.bid || 0);
        const vendorPrice = Number(
            record.vendorPrice ||
            builtInVendorPrice(record.name) ||
            0
        );
        const recentTradeMedian = Number(
            record.recentTradeMedian ||
            record.lastSold ||
            0
        );

        /*
         * Recommendation values represent immediate, dependable liquidation.
         * A sell listing is not guaranteed to fill, so use the highest active
         * buy order after tax, with vendor value as the fallback.
         */
        const candidates = [
            {
                netUnitValue: bid > 0 ? netPrice(bid) : 0,
                source: 'Exchange Buy Order'
            },
            {
                netUnitValue: vendorPrice,
                source: 'Vendor'
            }
        ].filter(candidate => candidate.netUnitValue > 0);

        const best = candidates.sort(
            (a, b) => b.netUnitValue - a.netUnitValue
        )[0];

        if (best) {
            return {
                ...best,
                ask,
                bid,
                vendorPrice,
                recentTradeMedian
            };
        }

        if (recentTradeMedian > 0) {
            return {
                netUnitValue: netPrice(recentTradeMedian),
                source: 'Recent Trade Estimate',
                ask,
                bid,
                vendorPrice,
                recentTradeMedian
            };
        }

        return {
            netUnitValue: 0,
            source: 'Unavailable',
            ask,
            bid,
            vendorPrice,
            recentTradeMedian
        };
    }

    function bestSaleValue(record, quantity = 1) {
        const count = Math.max(0, Number(quantity) || 0);
        const sale = analyzeImmediateSale(record);
        const bidDepth = executeMarketDepth(record, 'bid', count);
        const vendorPrice = Number(sale.vendorPrice || 0);
        const vendorAllValue = vendorPrice > 0
            ? vendorPrice * count
            : NaN;
        let value = sale.netUnitValue > 0
            ? sale.netUnitValue * count
            : NaN;
        let source = sale.source;
        let exchangeQuantity = 0;
        let vendorQuantity = source === 'Vendor' ? count : 0;
        let depthComplete = true;

        if (sale.source === 'Exchange Buy Order' && bidDepth.known) {
            let remaining = count;
            let exchangeNetValue = 0;

            for (const level of normalizedDepthLevels(record, 'bid')) {
                if (!(remaining > 0)) break;

                const netUnit = netPrice(level.price);
                if (vendorPrice > 0 && netUnit <= vendorPrice) {
                    break;
                }

                const amount = Math.min(remaining, level.quantity);
                exchangeNetValue += amount * netUnit;
                exchangeQuantity += amount;
                remaining -= amount;
            }

            vendorQuantity = vendorPrice > 0 ? remaining : 0;
            depthComplete = remaining <= 0.000001 || vendorQuantity > 0;

            if (vendorQuantity > 0) {
                value = exchangeNetValue + vendorQuantity * vendorPrice;
                source = exchangeQuantity > 0
                    ? 'Exchange Buy Order + Vendor'
                    : 'Vendor';
            } else if (remaining <= 0.000001) {
                value = exchangeNetValue;
                source = 'Exchange Buy Order';
            } else {
                value = NaN;
                source = 'Unavailable';
            }

            if (
                Number.isFinite(vendorAllValue) &&
                vendorAllValue >= Number(value || 0)
            ) {
                value = vendorAllValue;
                source = 'Vendor';
                exchangeQuantity = 0;
                vendorQuantity = count;
                depthComplete = true;
            }
        }

        return {
            value,
            source,
            exchangeValue:
                source === 'Exchange Buy Order' ||
                source === 'Exchange Buy Order + Vendor'
                    ? value
                    : NaN,
            vendorValue: vendorAllValue,
            marketPrice: sale.bid,
            vendorPrice: sale.vendorPrice,
            recentTradeMedian: sale.recentTradeMedian,
            marketSource: source,
            askRejected: false,
            bidIgnored: false,
            depthKnown: bidDepth.known,
            depthComplete,
            availableAtBestPrice: bidDepth.known
                ? bidDepth.bestPriceQuantity
                : Number(record?.bidQuantity || 0),
            totalAvailable: bidDepth.known
                ? bidDepth.totalAvailable
                : 0,
            bestPrice: bidDepth.known
                ? bidDepth.bestPrice
                : Number(sale.bid || 0),
            requestedQuantity: count,
            exchangeQuantity,
            vendorQuantity
        };
    }

    function bestAvailableSaleValue(record, quantity = 1) {
        return bestSaleValue(record, quantity);
    }

    function saleChoiceLabel(action, sale) {
        return sale?.source && sale.source !== 'Unknown'
            ? `${action} → ${sale.source}`
            : action;
    }


    function economySkillLockState(skill, requiredLevel) {
        const level = Number(state.skillLevels?.[skill] || 0);
        const known = Number.isFinite(level) && level > 0;
        const required = Math.max(1, Number(requiredLevel) || 1);

        return {
            known,
            level: known ? level : 0,
            requiredLevel: required,
            locked: known && level < required
        };
    }

    function sharedPriceRecord(itemName) {
        const normalized = normalizeName(itemName);
        if (!normalized) return null;

        const names = [normalized];

        if (normalized.endsWith('s')) {
            names.push(normalized.slice(0, -1));
        } else {
            names.push(`${normalized}s`);
        }

        return findItemPrice(names);
    }

    function liveMarketTimestamp(record) {
        if (!record) return 0;

        const hasMarketData =
            Number(record.ask || 0) > 0 ||
            Number(record.bid || 0) > 0 ||
            Number(record.lastSold || 0) > 0 ||
            Number(record.recentTradeMedian || 0) > 0 ||
            (Array.isArray(record.askDepth) && record.askDepth.length > 0) ||
            (Array.isArray(record.bidDepth) && record.bidDepth.length > 0);

        if (!hasMarketData) return 0;

        return Math.max(
            Number(record.depthCapturedAt || 0),
            Number(record.capturedAt || 0)
        );
    }

    function priceFreshnessInfo(records) {
        const list = (Array.isArray(records) ? records : [records])
            .filter(Boolean);
        const timestamps = list
            .map(liveMarketTimestamp)
            .filter(timestamp => timestamp > 0);

        if (!timestamps.length) {
            return {
                label: 'Vendor only',
                stale: false,
                className: 'tqm-freshness-fallback',
                timestamp: 0
            };
        }

        /*
         * Use the oldest live quote involved in the calculation so mixed
         * fresh/stale inputs are reported conservatively.
         */
        const timestamp = Math.min(...timestamps);
        const ageMs = Math.max(0, Date.now() - timestamp);
        const ageSeconds = Math.floor(ageMs / 1000);
        let label = 'Just now';

        if (ageSeconds >= 86400) {
            label = `${Math.floor(ageSeconds / 86400)}d ago`;
        } else if (ageSeconds >= 3600) {
            label = `${Math.floor(ageSeconds / 3600)}h ago`;
        } else if (ageSeconds >= 60) {
            label = `${Math.floor(ageSeconds / 60)}m ago`;
        } else if (ageSeconds >= 10) {
            label = `${ageSeconds}s ago`;
        }

        const stale = ageMs >= 30 * 60 * 1000;

        return {
            label,
            stale,
            className: stale
                ? 'tqm-freshness-stale'
                : 'tqm-freshness-fresh',
            timestamp
        };
    }

    function calculationSourceIndicator({
        source = '',
        recordOrRecords = null,
        skill = '',
        includeInventory = false,
        includeRecipe = true
    } = {}) {
        const preferences = {
            ...DEFAULT_STATE.preferences,
            ...(state.preferences || {})
        };

        if (
            !state.developerMode ||
            !preferences.showCalculationSourceIndicators
        ) {
            return '';
        }

        const freshness =
            recordOrRecords &&
            typeof recordOrRecords === 'object' &&
            !Array.isArray(recordOrRecords) &&
            typeof recordOrRecords.label === 'string' &&
            typeof recordOrRecords.className === 'string'
                ? recordOrRecords
                : priceFreshnessInfo(recordOrRecords);

        const badges = [];
        const sourceText = String(source || '');

        if (freshness.timestamp > 0) {
            badges.push(
                freshness.stale
                    ? ['⚠', 'Market stale', 'tqm-source-warning']
                    : ['✓', 'Live Market', 'tqm-source-ok']
            );
        }

        if (
            /vendor/i.test(sourceText) ||
            freshness.timestamp <= 0
        ) {
            badges.push(['✓', 'Vendor', 'tqm-source-ok']);
        }

        if (includeInventory) {
            badges.push(['✓', 'Inventory', 'tqm-source-ok']);
        }

        if (skill) {
            badges.push(['✓', 'Mastery', 'tqm-source-ok']);

            const cityBonus =
                Number(CITY_BONUSES?.[state.currentCity]?.[skill] || 0);

            if (cityBonus > 0 && state.currentCity !== 'None') {
                badges.push([
                    '✓',
                    state.currentCity,
                    'tqm-source-ok'
                ]);
            }
        }

        if (includeRecipe) {
            badges.push(['✓', 'Recipe DB', 'tqm-source-ok']);
        }

        return `
            <small class="tqm-calc-source-indicator">
                ${badges.map(([icon, label, className]) => `
                    <span class="${className}">
                        ${icon} ${escapeHtml(label)}
                    </span>
                `).join('')}
            </small>
        `;
    }

    function renderPriceSource(
        source,
        recordOrRecords,
        context = {}
    ) {
        const preferences = {
            ...DEFAULT_STATE.preferences,
            ...(state.preferences || {})
        };
        const freshness =
            recordOrRecords &&
            typeof recordOrRecords === 'object' &&
            !Array.isArray(recordOrRecords) &&
            typeof recordOrRecords.label === 'string' &&
            typeof recordOrRecords.className === 'string'
                ? recordOrRecords
                : priceFreshnessInfo(recordOrRecords);

        return `
            <span>${escapeHtml(source || 'N/A')}</span>
            ${preferences.showPriceFreshness ? `
                <small class="tqm-price-freshness ${freshness.className}">
                    ${escapeHtml(freshness.label)}
                </small>
            ` : ''}
            ${calculationSourceIndicator({
                source,
                recordOrRecords: freshness,
                skill: context.skill || '',
                includeInventory: Boolean(context.includeInventory),
                includeRecipe:
                    context.includeRecipe === undefined
                        ? true
                        : Boolean(context.includeRecipe)
            })}
        `;
    }


    /*
     * Shared action-profit engine for Quartermaster's skill tabs and Ctrl
     * inspector. The recipe chooses whether consumed materials use purchase
     * cost or immediate-sale opportunity cost, while tax, depth, yield,
     * current-city speed, supply fees, inventory capacity, and sale value all
     * come through the same path.
     */
    function calculateSharedCraftProfit(recipe, options = {}) {
        if (!recipe) return null;

        const inputMode =
            options.inputMode ||
            recipe.inputMode ||
            'purchase';
        const outputPerBatch = Math.max(
            0.0001,
            Number(recipe.outputPerBatch || 1)
        );
        const cycle = adjustedCraftTime(
            Number(recipe.baseCycle || 0),
            recipe.skill
        );
        const fee = Number(recipe.fee || 0);

        const ingredients = (recipe.ingredients || []).map(ingredient => {
            const quantity = Math.max(
                0,
                Number(ingredient.quantity || 0)
            );
            const record = sharedPriceRecord(ingredient.name);
            const costResult = inputMode === 'opportunity'
                ? bestAvailableSaleValue(record, quantity)
                : resolveCraftInputCost(record, quantity);
            const owned = inventoryQuantityForItem(
                ingredient.name
            );

            return {
                name: ingredient.name,
                quantity,
                record,
                owned,
                value: Number(costResult.value),
                source: costResult.source || 'Unavailable',
                costResult,
                missingForNextAction: Math.max(
                    0,
                    quantity - owned
                )
            };
        });

        const allInputsKnown = ingredients.every(
            ingredient => Number.isFinite(ingredient.value)
        );
        const inputCost = allInputsKnown
            ? ingredients.reduce(
                (sum, ingredient) =>
                    sum + Number(ingredient.value || 0),
                0
            )
            : NaN;
        const batchCost = Number.isFinite(inputCost)
            ? inputCost + fee
            : NaN;
        const costPerItem = Number.isFinite(batchCost)
            ? batchCost / outputPerBatch
            : NaN;

        const outputRecord = sharedPriceRecord(recipe.name);
        const outputSale = bestAvailableSaleValue(
            outputRecord,
            outputPerBatch
        );
        const outputValue = Number(outputSale.value);
        const profitPerAction =
            Number.isFinite(outputValue) &&
            Number.isFinite(batchCost)
                ? outputValue - batchCost
                : NaN;
        const profitPerItem = Number.isFinite(profitPerAction)
            ? profitPerAction / outputPerBatch
            : NaN;
        const profitPerHour =
            Number.isFinite(profitPerAction) &&
            cycle > 0
                ? goldPerHour(profitPerAction, cycle)
                : NaN;

        const ask = Number(outputRecord?.ask || 0);
        const listNetPerItem = ask > 0
            ? netPrice(ask)
            : NaN;
        const askProfitPerItem =
            Number.isFinite(listNetPerItem) &&
            Number.isFinite(costPerItem)
                ? listNetPerItem - costPerItem
                : NaN;
        const askProfitPerHour =
            Number.isFinite(askProfitPerItem) &&
            cycle > 0
                ? goldPerHour(
                    askProfitPerItem * outputPerBatch,
                    cycle
                )
                : NaN;

        const actionLimits = ingredients
            .filter(ingredient => ingredient.quantity > 0)
            .map(ingredient =>
                Math.floor(
                    Number(ingredient.owned || 0) /
                    ingredient.quantity
                )
            );
        const maxActions = actionLimits.length
            ? Math.max(0, Math.min(...actionLimits))
            : 0;
        const maxCraftable =
            maxActions * outputPerBatch;
        const missingMaterials = ingredients.filter(
            ingredient => ingredient.missingForNextAction > 0
        );
        const lock = economySkillLockState(
            recipe.skill,
            recipe.requiredLevel
        );
        const freshness = priceFreshnessInfo([
            outputRecord,
            ...ingredients.map(ingredient => ingredient.record)
        ]);

        return {
            recipe,
            inputMode,
            outputPerBatch,
            cycle,
            fee,
            ingredients,
            inputCost,
            batchCost,
            costPerItem,
            outputRecord,
            outputSale,
            outputValue,
            ask,
            listNetPerItem,
            instantNetPerItem:
                Number.isFinite(outputValue)
                    ? outputValue / outputPerBatch
                    : NaN,
            instantSource:
                outputSale.source || 'Unavailable',
            profitPerAction,
            profitPerItem,
            profitPerHour,
            askProfitPerItem,
            askProfitPerHour,
            maxActions,
            maxCraftable,
            missingMaterials,
            lock,
            locked: lock.locked,
            freshness
        };
    }

    function calculateWoodRows() {
        const carpentry = yieldMultiplier('carpentry');

        return WOODS.map(wood => {
            const logRecord = findItemPrice([`${wood} Log`, `${wood} Logs`]);
            const plankRecord = findItemPrice([`${wood} Plank`, `${wood} Planks`]);
            const beamRecord = findItemPrice([`${wood} Beam`, `${wood} Beams`]);

            const logPrice = chosenMarketPrice(logRecord);
            const plankPrice = chosenMarketPrice(plankRecord);
            const beamPrice = chosenMarketPrice(beamRecord);

            const planksPerLog = carpentry;
            const beamsPerLog = (planksPerLog / 2) * carpentry;

            const logSale = bestAvailableSaleValue(logRecord, 1);
            const plankSale = bestSaleValue(plankRecord, planksPerLog);
            const beamSale = bestSaleValue(beamRecord, beamsPerLog);

            const logRecommendation = bestSaleValue(
                logRecord,
                1
            );
            const plankRecommendation = bestSaleValue(
                plankRecord,
                planksPerLog
            );
            const beamRecommendation = bestSaleValue(
                beamRecord,
                beamsPerLog
            );

            const plankPerLogRecommendation = plankRecommendation;
            const beamPerLogRecommendation = beamRecommendation;

            const plankCycle = adjustedCraftTime(
                WOOD_CRAFT_TIMES[wood]?.plank,
                'carpentry'
            );
            const beamCycle = adjustedCraftTime(
                WOOD_CRAFT_TIMES[wood]?.beam,
                'carpentry'
            );

            const plankChainTime = plankCycle;
            const beamChainTime =
                plankCycle +
                (planksPerLog / 2) * beamCycle;


            const rawNet = logSale.value;
            const plankNet = plankSale.value;
            const beamNet = beamSale.value;
            const hasPlankPrices =
                Number.isFinite(rawNet) &&
                Number.isFinite(plankNet);
            const hasBeamPrices =
                Number.isFinite(rawNet) &&
                Number.isFinite(beamNet);

            const plankProfitPerLog = hasPlankPrices
                ? plankNet - rawNet
                : NaN;
            const beamProfitPerLog = hasBeamPrices
                ? beamNet - rawNet
                : NaN;

            /*
             * Incremental action-profit model:
             * - Plank action consumes one log.
             * - Beam action consumes two planks.
             * Inputs and outputs use immediate sale value: the best active
             * Exchange buy order after tax, or vendor value as fallback.
             */
            /*
             * Wood-tab action profit measures the value added by crafting
             * materials already owned. Value the consumed input by what it
             * could be sold for immediately, not by a potentially misleading
             * lowest sell listing.
             */
            const requiredLevel = WOOD_REQUIRED_LEVELS[wood] || 1;
            const plankShared = calculateSharedCraftProfit(
                {
                    name: `${wood} Plank`,
                    skill: 'carpentry',
                    requiredLevel,
                    ingredients: [
                        {
                            name: `${wood} Log`,
                            quantity: 1
                        }
                    ],
                    outputPerBatch: carpentry,
                    baseCycle:
                        WOOD_CRAFT_TIMES[wood]?.plank || 0,
                    fee: 0,
                    inputMode: 'opportunity'
                }
            );
            const beamShared = calculateSharedCraftProfit(
                {
                    name: `${wood} Beam`,
                    skill: 'carpentry',
                    requiredLevel,
                    ingredients: [
                        {
                            name: `${wood} Plank`,
                            quantity: 2
                        }
                    ],
                    outputPerBatch: carpentry,
                    baseCycle:
                        WOOD_CRAFT_TIMES[wood]?.beam || 0,
                    fee: 0,
                    inputMode: 'opportunity'
                }
            );

            const plankInput =
                plankShared?.ingredients?.[0]?.costResult || {
                    value: NaN,
                    source: 'Unavailable'
                };
            const plankInputCost =
                Number(plankShared?.inputCost);
            const plankActionSale =
                plankShared?.outputSale;
            const plankOutputValue =
                Number(plankShared?.outputValue);
            const plankActionProfit =
                Number(plankShared?.profitPerAction);
            const plankActionProfitHour =
                Number(plankShared?.profitPerHour);

            const beamInput =
                beamShared?.ingredients?.[0]?.costResult || {
                    value: NaN,
                    source: 'Unavailable'
                };
            const beamInputCost =
                Number(beamShared?.inputCost);
            const beamActionSale =
                beamShared?.outputSale;
            const beamOutputValue =
                Number(beamShared?.outputValue);
            const beamActionProfit =
                Number(beamShared?.profitPerAction);
            const beamActionProfitHour =
                Number(beamShared?.profitPerHour);

            const plankProfitHour = goldPerHour(
                plankProfitPerLog,
                plankChainTime
            );
            const beamProfitHour = goldPerHour(
                beamProfitPerLog,
                beamChainTime
            );

            const plankBestProfitPort = bestCityResult(city => {
                const seconds = adjustedCraftTimeForCity(
                    WOOD_CRAFT_TIMES[wood]?.plank,
                    'carpentry',
                    city
                );
                return {
                    seconds,
                    goldPerHour: goldPerHour(
                        plankProfitPerLog,
                        seconds
                    )
                };
            });

            const beamBestProfitPort = bestCityResult(city => {
                const cityPlankCycle = adjustedCraftTimeForCity(
                    WOOD_CRAFT_TIMES[wood]?.plank,
                    'carpentry',
                    city
                );
                const cityBeamCycle = adjustedCraftTimeForCity(
                    WOOD_CRAFT_TIMES[wood]?.beam,
                    'carpentry',
                    city
                );
                const seconds =
                    cityPlankCycle +
                    (planksPerLog / 2) * cityBeamCycle;
                return {
                    seconds,
                    goldPerHour: goldPerHour(
                        beamProfitPerLog,
                        seconds
                    )
                };
            });

            const plankBestPort = bestCityResult(city => {
                const seconds = adjustedCraftTimeForCity(
                    WOOD_CRAFT_TIMES[wood]?.plank,
                    'carpentry',
                    city
                );
                return {
                    seconds,
                    goldPerHour: goldPerHour(plankNet, seconds)
                };
            });

            const beamBestPort = bestCityResult(city => {
                const cityPlankCycle = adjustedCraftTimeForCity(
                    WOOD_CRAFT_TIMES[wood]?.plank,
                    'carpentry',
                    city
                );
                const cityBeamCycle = adjustedCraftTimeForCity(
                    WOOD_CRAFT_TIMES[wood]?.beam,
                    'carpentry',
                    city
                );
                const seconds =
                    cityPlankCycle +
                    (planksPerLog / 2) * cityBeamCycle;
                return {
                    seconds,
                    goldPerHour: goldPerHour(beamNet, seconds)
                };
            });

            const canCraft = hasRequiredLevel('carpentry', requiredLevel);
            const locked = economySkillLockState(
                'carpentry',
                requiredLevel
            ).locked;

            const options = [
                {
                    choice: saleChoiceLabel(
                        'Sell Logs',
                        logRecommendation
                    ),
                    value: logRecommendation.value,
                    seconds: 0,
                    available: true
                },
                {
                    choice: saleChoiceLabel(
                        'Make Planks',
                        plankRecommendation
                    ),
                    value: plankRecommendation.value,
                    seconds: plankChainTime,
                    available: canCraft
                },
                {
                    choice: saleChoiceLabel(
                        'Make Beams',
                        beamRecommendation
                    ),
                    value: beamRecommendation.value,
                    seconds: beamChainTime,
                    available: canCraft
                }
            ].filter(option =>
                Number.isFinite(option.value) &&
                option.value > 0 &&
                option.available
            );

            const bestPerLog =
                [...options].sort((a, b) => b.value - a.value)[0] || null;
            const bestPerHour = options
                .filter(option => option.seconds > 0)
                .map(option => ({
                    ...option,
                    goldPerHour: goldPerHour(
                        option.value,
                        option.seconds
                    )
                }))
                .sort((a, b) => b.goldPerHour - a.goldPerHour)[0] || null;

            return {
                material: wood,
                raw: logPrice,
                processed: plankPrice,
                final: beamPrice,
                logSale,
                plankSale,
                beamSale,
                logRecommendation,
                plankRecommendation,
                beamRecommendation,
                plankPerLogRecommendation,
                beamPerLogRecommendation,
                rawNet,
                plankNet,
                beamNet,
                plankCycle,
                beamCycle,
                plankChainTime,
                beamChainTime,

                plankGoldHour: goldPerHour(
                    plankPerLogRecommendation.value,
                    plankChainTime
                ),
                beamGoldHour: goldPerHour(
                    beamPerLogRecommendation.value,
                    beamChainTime
                ),
                plankProfitPerLog,
                beamProfitPerLog,
                plankInput,
                plankInputCost,
                plankActionSale,
                plankOutputValue,
                plankActionProfit,
                plankActionProfitHour,
                beamInput,
                beamInputCost,
                beamActionSale,
                beamOutputValue,
                beamActionProfit,
                beamActionProfitHour,
                plankProfitHour,
                beamProfitHour,
                plankBestProfitPort,
                beamBestProfitPort,
                plankBestPort,
                beamBestPort,
                requiredLevel,
                canCraft,
                locked,
                logRecord,
                plankRecord,
                beamRecord,
                plankShared,
                beamShared,
                bestPerLog,
                bestPerHour,
                volume:
                    beamRecord?.weeklyVolume ||
                    plankRecord?.weeklyVolume ||
                    logRecord?.weeklyVolume ||
                    0
            };
        });
    }

    function calculateMetalRows() {
        const smelting = yieldMultiplier('smelting');
        const crafting = yieldMultiplier('crafting');

        return METALS.map(metal => {
            const oreRecord = findItemPrice([`${metal} Ore`]);
            const barRecord = findItemPrice([`${metal} Bar`, `${metal} Bars`]);
            const nailRecord = findItemPrice([`${metal} Nail`, `${metal} Nails`]);

            const orePrice = chosenMarketPrice(oreRecord);
            const barPrice = chosenMarketPrice(barRecord);
            const nailPrice = chosenMarketPrice(nailRecord);

            const barsPerOre = smelting / 2;
            const nailsPerOre = barsPerOre * 4 * crafting;

            const oreSale = exchangeBuyCost(oreRecord, 1);
            const barSale = bestSaleValue(barRecord, barsPerOre);
            const nailSale = bestSaleValue(nailRecord, nailsPerOre);

            const oreRecommendation = bestSaleValue(
                oreRecord,
                1
            );
            const barRecommendation = bestSaleValue(
                barRecord,
                barsPerOre
            );
            const nailRecommendation = bestSaleValue(
                nailRecord,
                nailsPerOre
            );

            const barCycle = adjustedCraftTime(
                METAL_CRAFT_TIMES[metal]?.bar,
                'smelting'
            );
            const nailCycle = adjustedCraftTime(
                METAL_CRAFT_TIMES[metal]?.nail,
                'crafting'
            );

            const barChainTime = barCycle / 2;
            const nailChainTime =
                barChainTime +
                barsPerOre * nailCycle;


            const rawNet = oreSale.value;
            const barNet = barSale.value;
            const nailNet = nailSale.value;
            const hasBarPrices =
                Number.isFinite(rawNet) &&
                Number.isFinite(barNet);
            const hasNailPrices =
                Number.isFinite(rawNet) &&
                Number.isFinite(nailNet);

            const feeInfo =
                SMELTING_SUPPLY_FEES[metal] ||
                { fee: 0, estimated: true };
            const smeltingFeePerOre = feeInfo.fee / 2;

            const barProfitPerOre = hasBarPrices
                ? barNet - rawNet - smeltingFeePerOre
                : NaN;
            const nailProfitPerOre = hasNailPrices
                ? nailNet - rawNet - smeltingFeePerOre
                : NaN;

            /*
             * Incremental action-profit model:
             * - Smelting action consumes two ore.
             * - Nail action consumes one bar.
             */
            const barShared = calculateSharedCraftProfit(
                {
                    name: `${metal} Bar`,
                    skill: 'smelting',
                    requiredLevel:
                        BAR_REQUIRED_LEVELS[metal] || 1,
                    ingredients: [
                        {
                            name: `${metal} Ore`,
                            quantity: 2
                        }
                    ],
                    outputPerBatch: smelting,
                    baseCycle:
                        METAL_CRAFT_TIMES[metal]?.bar || 0,
                    fee: Number(feeInfo.fee || 0),
                    inputMode: 'purchase'
                }
            );
            const barActionInput =
                barShared?.ingredients?.[0]?.costResult || {
                    value: NaN,
                    source: 'Unavailable'
                };
            const barActionInputCost =
                Number(barShared?.inputCost);
            const barActionSale =
                barShared?.outputSale;
            const barActionOutputValue =
                Number(barShared?.outputValue);
            const barActionProfit =
                Number(barShared?.profitPerAction);
            const barActionProfitHour =
                Number(barShared?.profitPerHour);

            const nailsPerAction = 4 * crafting;
            const nailShared = calculateSharedCraftProfit(
                {
                    name: `${metal} Nails`,
                    skill: 'crafting',
                    requiredLevel:
                        NAIL_REQUIRED_LEVELS[metal] || 1,
                    ingredients: [
                        {
                            name: `${metal} Bar`,
                            quantity: 1
                        }
                    ],
                    outputPerBatch: nailsPerAction,
                    baseCycle:
                        METAL_CRAFT_TIMES[metal]?.nail || 0,
                    fee: 0,
                    inputMode: 'purchase'
                }
            );
            const nailActionInput =
                nailShared?.ingredients?.[0]?.costResult || {
                    value: NaN,
                    source: 'Unavailable'
                };
            const nailActionInputCost =
                Number(nailShared?.inputCost);
            const nailActionSale =
                nailShared?.outputSale;
            const nailActionOutputValue =
                Number(nailShared?.outputValue);
            const nailActionProfit =
                Number(nailShared?.profitPerAction);
            const nailActionProfitHour =
                Number(nailShared?.profitPerHour);

            const barProfitHour = goldPerHour(
                barProfitPerOre,
                barChainTime
            );
            const nailProfitHour = goldPerHour(
                nailProfitPerOre,
                nailChainTime
            );

            const barBestProfitPort = bestCityResult(city => {
                const seconds =
                    adjustedCraftTimeForCity(
                        METAL_CRAFT_TIMES[metal]?.bar,
                        'smelting',
                        city
                    ) / 2;
                return {
                    seconds,
                    goldPerHour: goldPerHour(
                        barProfitPerOre,
                        seconds
                    )
                };
            });

            const nailBestProfitPort = bestCityResult(city => {
                const cityBarTime =
                    adjustedCraftTimeForCity(
                        METAL_CRAFT_TIMES[metal]?.bar,
                        'smelting',
                        city
                    ) / 2;
                const cityNailTime =
                    barsPerOre *
                    adjustedCraftTimeForCity(
                        METAL_CRAFT_TIMES[metal]?.nail,
                        'crafting',
                        city
                    );
                const seconds = cityBarTime + cityNailTime;
                return {
                    seconds,
                    goldPerHour: goldPerHour(
                        nailProfitPerOre,
                        seconds
                    )
                };
            });

            const barBestPort = bestCityResult(city => {
                const seconds =
                    adjustedCraftTimeForCity(
                        METAL_CRAFT_TIMES[metal]?.bar,
                        'smelting',
                        city
                    ) / 2;
                return {
                    seconds,
                    goldPerHour: goldPerHour(barNet, seconds)
                };
            });

            const nailBestPort = bestCityResult(city => {
                const cityBarTime =
                    adjustedCraftTimeForCity(
                        METAL_CRAFT_TIMES[metal]?.bar,
                        'smelting',
                        city
                    ) / 2;
                const cityNailTime =
                    barsPerOre *
                    adjustedCraftTimeForCity(
                        METAL_CRAFT_TIMES[metal]?.nail,
                        'crafting',
                        city
                    );
                const seconds = cityBarTime + cityNailTime;
                return {
                    seconds,
                    goldPerHour: goldPerHour(nailNet, seconds)
                };
            });

            const miningRequiredLevel =
                MINING_REQUIRED_LEVELS[metal] || 1;
            const barRequiredLevel = BAR_REQUIRED_LEVELS[metal] || 1;
            const nailRequiredLevel = NAIL_REQUIRED_LEVELS[metal] || 1;
            const canMine = hasRequiredLevel(
                'mining',
                miningRequiredLevel
            );
            const canSmelt = hasRequiredLevel(
                'smelting',
                barRequiredLevel
            );
            const canCraftNails =
                canSmelt &&
                hasRequiredLevel('crafting', nailRequiredLevel);
            const barLocked = economySkillLockState(
                'smelting',
                barRequiredLevel
            ).locked;
            const nailLocked = economySkillLockState(
                'crafting',
                nailRequiredLevel
            ).locked;

            const options = [
                {
                    choice: saleChoiceLabel(
                        'Sell Ore',
                        oreRecommendation
                    ),
                    value: oreRecommendation.value,
                    seconds: 0,
                    available: true
                },
                {
                    choice: saleChoiceLabel(
                        'Smelt Bars',
                        barRecommendation
                    ),
                    value: barRecommendation.value,
                    seconds: barChainTime,
                    available: canSmelt
                },
                {
                    choice: saleChoiceLabel(
                        'Make Nails',
                        nailRecommendation
                    ),
                    value: nailRecommendation.value,
                    seconds: nailChainTime,
                    available: canCraftNails
                }
            ].filter(option =>
                Number.isFinite(option.value) &&
                option.value > 0 &&
                option.available
            );

            const bestPerOre =
                [...options].sort((a, b) => b.value - a.value)[0] || null;
            const bestPerHour = options
                .filter(option => option.seconds > 0)
                .map(option => ({
                    ...option,
                    goldPerHour: goldPerHour(
                        option.value,
                        option.seconds
                    )
                }))
                .sort((a, b) => b.goldPerHour - a.goldPerHour)[0] || null;

            return {
                material: metal,
                raw: orePrice,
                processed: barPrice,
                final: nailPrice,
                oreSale,
                barSale,
                nailSale,
                oreRecommendation,
                barRecommendation,
                nailRecommendation,
                rawNet,
                barNet,
                nailNet,
                barCycle,
                nailCycle,
                barChainTime,
                nailChainTime,

                barGoldHour: goldPerHour(
                    barRecommendation.value,
                    barChainTime
                ),
                nailGoldHour: goldPerHour(
                    nailRecommendation.value,
                    nailChainTime
                ),
                fee: feeInfo.fee,
                feeEstimated: feeInfo.estimated,
                smeltingFeePerOre,
                barProfitPerOre,
                nailProfitPerOre,
                barActionInput,
                barActionInputCost,
                barActionSale,
                barActionOutputValue,
                barActionProfit,
                barActionProfitHour,
                nailActionInput,
                nailActionInputCost,
                nailsPerAction,
                nailActionSale,
                nailActionOutputValue,
                nailActionProfit,
                nailActionProfitHour,
                barProfitHour,
                nailProfitHour,
                barBestProfitPort,
                nailBestProfitPort,
                barBestPort,
                nailBestPort,
                miningRequiredLevel,
                barRequiredLevel,
                nailRequiredLevel,
                canMine,
                canSmelt,
                canCraftNails,
                barLocked,
                nailLocked,
                oreRecord,
                barRecord,
                nailRecord,
                barShared,
                nailShared,
                bestPerOre,
                bestPerHour,
                volume:
                    nailRecord?.weeklyVolume ||
                    barRecord?.weeklyVolume ||
                    oreRecord?.weeklyVolume ||
                    0
            };
        });
    }

    function gatheringRecipeForItem(skill, itemName) {
        const normalizedItem = normalizeName(itemName);

        return BUILT_IN_XP_RECIPES.find(recipe =>
            recipe.skill === skill &&
            normalizeName(recipe.item) === normalizedItem
        ) || null;
    }

    function calculateCookingRows() {
        const fishingMultiplier = yieldMultiplier('fishing');
        const outputMultiplier = yieldMultiplier('cooking');

        return COOKING_RECIPES.map(recipe => {
            const ingredientRecord = findItemPrice([
                recipe.ingredient,
                `${recipe.ingredient}s`
            ]);
            const cookedRecord = findItemPrice([recipe.item]);

            const ingredientPrice = chosenMarketPrice(ingredientRecord);
            const cookedPrice = chosenMarketPrice(cookedRecord);
            const shared = calculateSharedCraftProfit(
                {
                    name: recipe.item,
                    skill: 'cooking',
                    requiredLevel: recipe.level,
                    ingredients: [
                        {
                            name: recipe.ingredient,
                            quantity: 1
                        }
                    ],
                    outputPerBatch: outputMultiplier,
                    baseCycle: recipe.cycle,
                    fee: Number(recipe.fee || 0),
                    inputMode: 'purchase'
                }
            );
            const outputPerBatch = shared.outputPerBatch;
            const canCraft = hasRequiredLevel('cooking', recipe.level);
            const locked = shared.locked;
            const ingredientSale =
                shared.ingredients?.[0]?.costResult || {
                    value: NaN,
                    source: 'Unavailable'
                };
            const cookedSale = shared.outputSale;
            const hasPrices =
                Number.isFinite(shared.inputCost) &&
                Number.isFinite(shared.outputValue);
            const grossAfterTax = shared.outputValue;
            const ingredientOpportunityCost = shared.inputCost;
            const profitPerBatch = shared.profitPerAction;
            const currentCycle = shared.cycle;
            const currentProfitHour = shared.profitPerHour;

            /*
             * Separate from-scratch recommendation:
             * one Fishing action -> Fishing Yield raw fish ->
             * Cooking Yield finished food.
             *
             * This does not alter the strict Exchange profit calculation
             * above, which remains one purchased raw fish per batch.
             */
            const fishingRecipe = gatheringRecipeForItem(
                'fishing',
                recipe.ingredient
            );
            const fishPerFishingAction = fishingMultiplier;
            const cookedPerFishingAction =
                fishPerFishingAction * outputMultiplier;
            const fishingCycle = fishingRecipe
                ? adjustedCraftTime(
                    fishingRecipe.cycle,
                    'fishing'
                )
                : 0;
            const cookingTimePerFishingAction =
                fishPerFishingAction * currentCycle;
            const fullChainTime =
                fishingCycle + cookingTimePerFishingAction;
            const fullChainFee =
                fishPerFishingAction *
                Number(recipe.fee || 0);
            const rawFishRecommendation =
                bestAvailableSaleValue(
                    ingredientRecord,
                    fishPerFishingAction
                );
            const cookedRecommendation =
                bestAvailableSaleValue(
                    cookedRecord,
                    cookedPerFishingAction
                );
            const cookedFromScratchValue =
                Number.isFinite(cookedRecommendation.value)
                    ? cookedRecommendation.value -
                        fullChainFee
                    : NaN;
            const fromScratchOptions = [
                {
                    choice: saleChoiceLabel(
                        'Sell Raw Fish',
                        rawFishRecommendation
                    ),
                    value: rawFishRecommendation.value,
                    seconds: fishingCycle
                },
                {
                    choice: saleChoiceLabel(
                        'Catch and Cook',
                        cookedRecommendation
                    ),
                    value: cookedFromScratchValue,
                    seconds: fullChainTime
                }
            ].filter(option =>
                Number.isFinite(option.value) &&
                option.value > 0 &&
                option.seconds > 0
            );
            const bestFromScratch = fromScratchOptions
                .map(option => ({
                    ...option,
                    goldPerHour: goldPerHour(
                        option.value,
                        option.seconds
                    )
                }))
                .sort(
                    (a, b) =>
                        b.goldPerHour - a.goldPerHour
                )[0] || null;

            const bestPort = Number.isFinite(profitPerBatch)
                ? bestCityResult(city => {
                    const seconds = adjustedCraftTimeForCity(
                        recipe.cycle,
                        'cooking',
                        city
                    );

                    return {
                        seconds,
                        goldPerHour: goldPerHour(
                            profitPerBatch,
                            seconds
                        )
                    };
                })
                : {
                    city: 'Driftmeadow',
                    goldPerHour: NaN,
                    seconds: adjustedCraftTimeForCity(
                        recipe.cycle,
                        'cooking',
                        'Driftmeadow'
                    )
                };

            return {
                ...recipe,
                ingredientPrice,
                cookedPrice,
                ingredientSale,
                cookedSale,
                outputPerBatch,
                canCraft,
                hasPrices,
                profitPerBatch,
                currentCycle,
                currentProfitHour,
                locked,
                shared,
                ingredientRecord,
                cookedRecord,
                fishingRecipe,
                fishPerFishingAction,
                cookedPerFishingAction,
                fishingCycle,
                cookingTimePerFishingAction,
                fullChainTime,
                fullChainFee,
                rawFishRecommendation,
                cookedRecommendation,
                cookedFromScratchValue,
                bestFromScratch,
                bestPort
            };
        });
    }

    function renderCooking() {
        const rows = calculateCookingRows();

        return `
            <div class="tqm-processing-layout">
            <section class="tqm-card">
                <div class="tqm-section-heading-row">
                    <div>
                        <h2>Cooking Profit</h2>
                        <p class="tqm-note">
                            One Cooking action. Raw fish use the lowest sell
                            listing when available, otherwise their immediate sale
                            value. Supply fees are included.
                        </p>
                    </div>
                </div>

                <div class="tqm-table-wrap">
                    <table class="tqm-table tqm-table-compact">
                        <thead>
                            <tr>
                                <th>Action</th>
                                <th>Profit</th>
                                <th>Profit/hr</th>
                                <th>Sell</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows.map(row => `
                                <tr class="${row.locked ? 'tqm-row-locked' : ''}">
                                    <td>
                                        <strong>
                                            ${escapeHtml(row.ingredient)}
                                            →
                                            ${escapeHtml(row.item)}
                                        </strong>
                                        <small class="tqm-level-note">
                                            Lv. ${row.level}${row.locked ? ' · Locked' : ''}
                                        </small>
                                    </td>
                                    <td title="${escapeHtml(craftProfitTooltip({
                                        inputLabel: `1 ${row.ingredient}`,
                                        inputCost: row.ingredientSale?.value,
                                        inputSource: row.ingredientSale?.source,
                                        outputLabel: row.item,
                                        outputQuantity: row.outputPerBatch,
                                        outputValue: row.cookedSale?.value,
                                        saleSource: row.cookedSale?.source,
                                        fee: Number(row.fee || 0),
                                        feeLabel: 'Cooking supply fee',
                                        profit: row.profitPerBatch,
                                        cycle: row.currentCycle
                                    }))}" class="${
                                        Number.isFinite(row.profitPerBatch)
                                            ? row.profitPerBatch >= 0
                                                ? 'tqm-profit-positive'
                                                : 'tqm-profit-negative'
                                            : ''
                                    }">
                                        ${
                                            Number.isFinite(
                                                row.profitPerBatch
                                            )
                                                ? signedMoney(
                                                    row.profitPerBatch
                                                )
                                                : 'N/A'
                                        }
                                    </td>
                                    <td class="${
                                        Number.isFinite(
                                            row.currentProfitHour
                                        )
                                            ? row.currentProfitHour >= 0
                                                ? 'tqm-profit-positive'
                                                : 'tqm-profit-negative'
                                            : ''
                                    }">
                                        ${
                                            Number.isFinite(
                                                row.currentProfitHour
                                            )
                                                ? signedMoneyPerHour(
                                                    row.currentProfitHour
                                                )
                                                : 'N/A'
                                        }
                                    </td>
                                    <td class="tqm-best">
                                        ${renderPriceSource(
                                            row.cookedSale?.source || 'N/A',
                                            [
                                                row.cookedRecord,
                                                row.ingredientRecord
                                            ],
                                            {
                                                skill: 'cooking',
                                                includeInventory: true
                                            }
                                        )}
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </section>

            <section class="tqm-card">
                <div class="tqm-section-heading-row">
                    <div>
                        <h2>Cooking Times</h2>
                        <p class="tqm-note">
                            Current-city Cooking speed bonuses are included.
                        </p>
                    </div>

                    <div class="tqm-best-port-badge">
                        <span>Best Cooking Port</span>
                        <strong>Driftmeadow</strong>
                    </div>
                </div>

                <div class="tqm-table-wrap">
                    <table class="tqm-table tqm-table-compact">
                        <thead>
                            <tr>
                                <th>Resource</th>
                                <th>Time</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows.map(row => `
                                <tr class="${row.locked ? 'tqm-row-locked' : ''}">
                                    <td>
                                        <strong>
                                            ${escapeHtml(row.item)}
                                        </strong>
                                    </td>
                                    <td>
                                        ${formatSeconds(row.currentCycle)}
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </section>
            </div>
        `;
    }

    function calculateAmmunitionRows() {
        const smithingMastery = yieldMultiplier('smithing');

        return METALS.flatMap(metal => {
            const barRecord = findItemPrice([`${metal} Bar`, `${metal} Bars`]);
            const barPrice = chosenMarketPrice(barRecord);
            const barSale = resolveCraftInputCost(
                barRecord,
                1
            );
            const feeInfo = SHOT_SUPPLY_FEES[metal] || {
                fee: 0,
                fuelLog: ''
            };
            const requiredLevel = SHOT_REQUIRED_LEVELS[metal] || 1;
            const canCraft = hasRequiredLevel('smithing', requiredLevel);

            return SHOT_TYPES.map(shotType => {
                const itemName = `${metal} ${shotType}`;
                const itemRecord = findItemPrice([itemName]);
                const itemPrice = chosenMarketPrice(itemRecord);

                const shared = calculateSharedCraftProfit(
                    {
                        name: itemName,
                        skill: 'smithing',
                        requiredLevel,
                        ingredients: [
                            {
                                name: `${metal} Bar`,
                                quantity: 1
                            }
                        ],
                        outputPerBatch:
                            SHOT_OUTPUT_PER_BATCH *
                            smithingMastery,
                        baseCycle:
                            SHOT_CRAFT_TIMES[metal] || 0,
                        fee: Number(feeInfo.fee || 0),
                        inputMode: 'purchase'
                    }
                );
                const outputPerBatch =
                    shared.outputPerBatch;
                const itemSale =
                    shared.outputSale;
                const actionBarSale =
                    shared.ingredients?.[0]?.costResult || {
                        value: NaN,
                        source: 'Unavailable'
                    };
                const grossSaleValue =
                    shared.outputValue;
                const barOpportunityCost =
                    shared.inputCost;
                const profitPerBatch =
                    shared.profitPerAction;
                const currentCycle =
                    shared.cycle;
                const currentProfitHour =
                    shared.profitPerHour;
                const locked =
                    shared.locked;

                const bestPort = bestCityResult(city => {
                    const seconds = adjustedCraftTimeForCity(
                        SHOT_CRAFT_TIMES[metal],
                        'smithing',
                        city
                    );

                    return {
                        seconds,
                        goldPerHour: goldPerHour(
                            profitPerBatch,
                            seconds
                        )
                    };
                });

                return {
                    metal,
                    shotType,
                    itemName,
                    requiredLevel,
                    canCraft,
                    cycle: currentCycle,
                    outputPerBatch,
                    fee: Number(feeInfo.fee || 0),
                    fuelLog: feeInfo.fuelLog || '',
                    barPrice,
                    itemPrice,
                    itemSale,
                    barSale: actionBarSale,
                    itemRecord,
                    barRecord,
                    shared,
                    locked,
                    grossSaleValue,
                    barOpportunityCost,
                    profitPerBatch,
                    profitHour: currentProfitHour,
                    bestPort
                };
            });
        });
    }

    function renderAmmunition() {
        const rows = calculateAmmunitionRows();

        return `
            <div class="tqm-processing-layout">
            <section class="tqm-card">
                <div class="tqm-section-heading-row">
                    <div>
                        <h2>Ammunition Crafting Profit</h2>
                        <p class="tqm-note">
                            Profit per Smithing action after input value,
                            supply fee, tax, and Smithing Yield. Missing bar asks
                            use the bar's immediate sale value.
                        </p>
                    </div>
                </div>

                <div class="tqm-table-wrap">
                    <table class="tqm-table tqm-table-compact">
                        <thead>
                            <tr>
                                <th>Product</th>
                                <th>Action</th>
                                <th>Profit</th>
                                <th>Profit/hr</th>
                                <th>Sell</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows.map(row => `
                                <tr class="${row.locked ? 'tqm-row-locked' : ''}">
                                    <td>
                                        <strong>
                                            ${escapeHtml(row.itemName)}
                                        </strong>
                                        <small class="tqm-level-note">
                                            Lv. ${row.requiredLevel}${row.locked ? ' · Locked' : ''}
                                        </small>
                                    </td>
                                    <td>
                                        1 Bar → ${Number(
                                            row.outputPerBatch
                                        ).toLocaleString(undefined, {
                                            maximumFractionDigits: 2
                                        })} ${escapeHtml(row.shotType)}
                                    </td>
                                    <td title="${escapeHtml(craftProfitTooltip({
                                        inputLabel: `1 ${row.metal} Bar`,
                                        inputCost: row.barOpportunityCost,
                                        inputSource: row.barSale?.source,
                                        outputLabel: `${row.metal} ${row.shotType}`,
                                        outputQuantity: row.outputPerBatch,
                                        outputValue: row.grossSaleValue,
                                        saleSource: row.itemSale?.source,
                                        fee: row.fee,
                                        feeLabel: 'Smithing supply fee',
                                        profit: row.profitPerBatch,
                                        cycle: row.cycle
                                    }))}" class="${
                                        Number.isFinite(row.profitPerBatch)
                                            ? row.profitPerBatch >= 0
                                                ? 'tqm-profit-positive'
                                                : 'tqm-profit-negative'
                                            : ''
                                    }">
                                        ${
                                            Number.isFinite(
                                                row.profitPerBatch
                                            )
                                                ? signedMoney(
                                                    row.profitPerBatch
                                                )
                                                : 'N/A'
                                        }
                                    </td>
                                    <td class="${
                                        Number.isFinite(row.profitHour)
                                            ? row.profitHour >= 0
                                                ? 'tqm-profit-positive'
                                                : 'tqm-profit-negative'
                                            : ''
                                    }">
                                        ${
                                            Number.isFinite(row.profitHour)
                                                ? signedMoneyPerHour(
                                                    row.profitHour
                                                )
                                                : 'N/A'
                                        }
                                    </td>
                                    <td class="tqm-best">
                                        ${renderPriceSource(
                                            row.itemSale?.source || 'N/A',
                                            [
                                                row.itemRecord,
                                                row.barRecord
                                            ],
                                            {
                                                skill: 'smithing',
                                                includeInventory: true
                                            }
                                        )}
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </section>

            <section class="tqm-card">
                <div class="tqm-section-heading-row">
                    <div>
                        <h2>Ammunition Crafting Times</h2>
                        <p class="tqm-note">
                            Current-city Smithing speed bonuses are included.
                        </p>
                    </div>

                    <div class="tqm-best-port-badge">
                        <span>Best Smithing Port</span>
                        <strong>
                            ${escapeHtml(bestCityForSkill('smithing'))}
                        </strong>
                    </div>
                </div>

                <div class="tqm-table-wrap">
                    <table class="tqm-table tqm-table-compact">
                        <thead>
                            <tr>
                                <th>Resource</th>
                                <th>Time</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows.map(row => `
                                <tr class="${row.locked ? 'tqm-row-locked' : ''}">
                                    <td>
                                        <strong>
                                            ${escapeHtml(row.itemName)}
                                        </strong>
                                    </td>
                                    <td>${formatSeconds(row.cycle)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </section>
            </div>
        `;
    }

    const REPAIR_KIT_RECIPES = [
        { item: 'Patch Kit', level: 1, cycle: 10, ingredients: [
            { name: 'Copper Nails', quantity: 2 },
            { name: 'Pine Plank', quantity: 2 }
        ]},
        { item: 'Caulking Kit', level: 5, cycle: 14, ingredients: [
            { name: 'Iron Nails', quantity: 3 },
            { name: 'Oak Plank', quantity: 3 }
        ]},
        { item: 'Hull Repair Kit', level: 10, cycle: 18, ingredients: [
            { name: 'Cinder Nails', quantity: 3 },
            { name: 'Fallow Plank', quantity: 4 }
        ]},
        { item: 'Deck Repair Kit', level: 15, cycle: 22, ingredients: [
            { name: 'Darkiron Nails', quantity: 4 },
            { name: 'Fenn Plank', quantity: 5 }
        ]},
        { item: 'Reinforcement Kit', level: 25, cycle: 28, ingredients: [
            { name: 'Mithril Nails', quantity: 4 },
            { name: 'Bracken Plank', quantity: 6 }
        ]},
        { item: 'Shipwright Kit', level: 40, cycle: 34, ingredients: [
            { name: 'Adamantite Nails', quantity: 5 },
            { name: 'Tallow Plank', quantity: 6 }
        ]},
        { item: 'Master Repair Kit', level: 55, cycle: 42, ingredients: [
            { name: 'Starmetal Nails', quantity: 5 },
            { name: 'Madder Plank', quantity: 8 }
        ]},
        { item: 'Hull Restoration Kit', level: 70, cycle: 50, ingredients: [
            { name: 'Stormglass Nails', quantity: 6 },
            { name: 'Silkwood Plank', quantity: 10 }
        ]},
        { item: 'Refit Crate', level: 80, cycle: 58, ingredients: [
            { name: 'Leviathan Nails', quantity: 8 },
            { name: 'Flint Plank', quantity: 12 }
        ]},
        { item: 'Master Refit Crate', level: 90, cycle: 70, ingredients: [
            { name: 'Abyssal Nails', quantity: 10 },
            { name: 'Holtwood Plank', quantity: 15 }
        ]}
    ];

    const CANNON_RECIPES = [
        { item: 'Copper 2-Pounder', metal: 'Copper', wood: 'Pine', level: 1, cycle: 30, bars: 20, beams: 5 },
        { item: 'Iron 4-Pounder', metal: 'Iron', wood: 'Oak', level: 5, cycle: 45, bars: 22, beams: 6 },
        { item: 'Cinder 6-Pounder', metal: 'Cinder', wood: 'Fallow', level: 10, cycle: 60, bars: 24, beams: 7 },
        { item: 'Darkiron 8-Pounder', metal: 'Darkiron', wood: 'Fenn', level: 20, cycle: 90, bars: 28, beams: 8 },
        { item: 'Mithril 9-Pounder', metal: 'Mithril', wood: 'Bracken', level: 30, cycle: 120, bars: 34, beams: 10 },
        { item: 'Adamantite 12-Pounder', metal: 'Adamantite', wood: 'Tallow', level: 40, cycle: 180, bars: 42, beams: 13 },
        { item: 'Starmetal 18-Pounder', metal: 'Starmetal', wood: 'Madder', level: 50, cycle: 300, bars: 55, beams: 17 },
        { item: 'Stormglass 24-Pounder', metal: 'Stormglass', wood: 'Silkwood', level: 60, cycle: 600, bars: 80, beams: 24 },
        { item: 'Leviathan 32-Pounder', metal: 'Leviathan', wood: 'Flint', level: 70, cycle: 900, bars: 150, beams: 40 },
        { item: 'Abyssal 42-Pounder', metal: 'Abyssal', wood: 'Holtwood', level: 80, cycle: 1800, bars: 350, beams: 60 }
    ];

    function plannerRecipeCatalog() {
        const recipes = [];

        WOODS.forEach(wood => {
            const requiredLevel = WOOD_REQUIRED_LEVELS[wood] || 1;

            recipes.push({
                id: `wood:${wood}:plank`,
                group: 'Carpentry',
                name: `${wood} Plank`,
                skill: 'carpentry',
                requiredLevel,
                ingredients: [{ name: `${wood} Log`, quantity: 1 }],
                outputPerBatch: yieldMultiplier('carpentry'),
                baseCycle: WOOD_CRAFT_TIMES[wood]?.plank || 0,
                fee: 0
            });

            recipes.push({
                id: `wood:${wood}:beam`,
                group: 'Carpentry',
                name: `${wood} Beam`,
                skill: 'carpentry',
                requiredLevel,
                ingredients: [{ name: `${wood} Plank`, quantity: 2 }],
                outputPerBatch: yieldMultiplier('carpentry'),
                baseCycle: WOOD_CRAFT_TIMES[wood]?.beam || 0,
                fee: 0
            });
        });

        METALS.forEach(metal => {
            const barLevel = BAR_REQUIRED_LEVELS[metal] || 1;
            const nailLevel = NAIL_REQUIRED_LEVELS[metal] || barLevel;
            const feeInfo = SMELTING_SUPPLY_FEES[metal] || {
                fee: 0,
                fuelLog: ''
            };

            recipes.push({
                id: `metal:${metal}:bar`,
                group: 'Smelting',
                name: `${metal} Bar`,
                skill: 'smelting',
                requiredLevel: barLevel,
                ingredients: [{ name: `${metal} Ore`, quantity: 2 }],
                outputPerBatch: yieldMultiplier('smelting'),
                baseCycle: METAL_CRAFT_TIMES[metal]?.bar || 0,
                fee: Number(feeInfo.fee || 0),
                fuelLog: feeInfo.fuelLog || ''
            });

            recipes.push({
                id: `crafting:nails:${metal}`,
                group: 'Crafting',
                name: `${metal} Nails`,
                skill: 'crafting',
                requiredLevel: nailLevel,
                ingredients: [{ name: `${metal} Bar`, quantity: 1 }],
                outputPerBatch: 4 * yieldMultiplier('crafting'),
                baseCycle: METAL_CRAFT_TIMES[metal]?.nail || 0,
                fee: 0
            });
        });

        REPAIR_KIT_RECIPES.forEach(recipe => {
            recipes.push({
                id: `crafting:repair:${recipe.item}`,
                group: 'Crafting',
                name: recipe.item,
                skill: 'crafting',
                requiredLevel: recipe.level,
                ingredients: recipe.ingredients,
                outputPerBatch: yieldMultiplier('crafting'),
                baseCycle: recipe.cycle,
                fee: 0
            });
        });

        calculateAmmunitionRows().forEach(row => {
            recipes.push({
                id: `smithing:shot:${row.metal}:${row.shotType}`,
                group: 'Smithing',
                name: row.itemName,
                skill: 'smithing',
                requiredLevel: row.requiredLevel,
                ingredients: [{ name: `${row.metal} Bar`, quantity: 1 }],
                outputPerBatch: row.outputPerBatch,
                baseCycle: SHOT_CRAFT_TIMES[row.metal] || 0,
                fee: row.fee,
                fuelLog: row.fuelLog
            });
        });

        CANNON_RECIPES.forEach(recipe => {
            recipes.push({
                id: `smithing:cannon:${recipe.metal}`,
                group: 'Smithing',
                name: recipe.item,
                skill: 'smithing',
                requiredLevel: recipe.level,
                ingredients: [
                    { name: `${recipe.metal} Bar`, quantity: recipe.bars },
                    { name: `${recipe.wood} Beam`, quantity: recipe.beams }
                ],
                outputPerBatch: yieldMultiplier('smithing'),
                baseCycle: recipe.cycle,
                fee: Number(SMELTING_SUPPLY_FEES[recipe.metal]?.fee || 0),
                fuelLog: SMELTING_SUPPLY_FEES[recipe.metal]?.fuelLog || ''
            });
        });

        COOKING_RECIPES.forEach(recipe => {
            recipes.push({
                id: `cooking:${recipe.item}`,
                group: 'Cooking',
                name: recipe.item,
                skill: 'cooking',
                requiredLevel: recipe.level,
                ingredients: [{ name: recipe.ingredient, quantity: 1 }],
                outputPerBatch: yieldMultiplier('cooking'),
                baseCycle: recipe.cycle,
                fee: Number(recipe.fee || 0),
                fuelLog: recipe.fuelLog || ''
            });
        });

        return recipes;
    }

    function plannerRecipeById(recipeId) {
        return plannerRecipeCatalog().find(recipe => recipe.id === recipeId) || null;
    }

    function calculatePlannerQueue() {
        const queue = Array.isArray(state.craftingPlanner?.queue)
            ? state.craftingPlanner.queue
            : [];

        const rows = queue.map((entry, index) => {
            const recipe = plannerRecipeById(entry.recipeId);
            const quantity = Math.max(1, Math.floor(Number(entry.quantity) || 1));

            if (!recipe) {
                return {
                    index,
                    recipeId: entry.recipeId,
                    quantity,
                    missing: true
                };
            }

            const outputPerBatch = Math.max(
                0.0001,
                Number(recipe.outputPerBatch) || 1
            );
            const batches = Math.ceil(quantity / outputPerBatch);
            const produced = batches * outputPerBatch;
            const cycle = adjustedCraftTime(recipe.baseCycle, recipe.skill);
            const seconds = batches * cycle;
            const feeTotal = batches * Number(recipe.fee || 0);
            const ingredients = (recipe.ingredients || []).filter(
                ingredient => ingredient?.name
            );
            const ingredientRows = ingredients.map(ingredient => {
                const required = batches * Number(ingredient.quantity || 0);
                const record = findItemPrice([
                    ingredient.name,
                    ingredient.name.endsWith('s')
                        ? ingredient.name.slice(0, -1)
                        : `${ingredient.name}s`
                ]);
                const price = chosenMarketPrice(record);
                const sale = exchangeBuyCost(record, required);

                return {
                    name: ingredient.name,
                    required,
                    price,
                    sale,
                    opportunityCost:
                        sale.value > 0
                            ? sale.value
                            : NaN
                };
            });

            const outputRecord = findItemPrice([
                recipe.name,
                recipe.name.endsWith('s')
                    ? recipe.name.slice(0, -1)
                    : `${recipe.name}s`
            ]);
            const outputPrice = chosenMarketPrice(outputRecord);
            const outputSale = bestSaleValue(
                outputRecord,
                produced
            );
            const inputOpportunityCost = ingredientRows.every(
                ingredient => Number.isFinite(ingredient.opportunityCost)
            )
                ? ingredientRows.reduce(
                    (sum, ingredient) =>
                        sum + ingredient.opportunityCost,
                    0
                )
                : NaN;
            const saleNet =
                outputSale.value > 0
                    ? outputSale.value
                    : NaN;
            const profit = Number.isFinite(inputOpportunityCost) &&
                Number.isFinite(saleNet)
                ? saleNet - inputOpportunityCost - feeTotal
                : NaN;

            const canCraft = hasRequiredLevel(
                recipe.skill,
                recipe.requiredLevel
            );

            return {
                index,
                recipeId: recipe.id,
                recipe,
                quantity,
                batches,
                produced,
                outputPerBatch,
                cycle,
                seconds,
                ingredientRows,
                outputPrice,
                outputSale,
                inputOpportunityCost,
                saleNet,
                feeTotal,
                profit,
                canCraft
            };
        });

        return {
            rows,
            totalSeconds: rows.reduce(
                (sum, row) => sum + (Number(row.seconds) || 0),
                0
            ),
            totalFees: rows.reduce(
                (sum, row) => sum + (Number(row.feeTotal) || 0),
                0
            ),
            totalProfitKnown: rows
                .filter(row => Number.isFinite(row.profit))
                .reduce((sum, row) => sum + row.profit, 0),
            unknownProfitRows: rows.filter(
                row => !row.missing && !Number.isFinite(row.profit)
            ).length,
            lockedRows: rows.filter(
                row => !row.missing && !row.canCraft
            ).length
        };
    }

    function renderCraftingPlanner() {
        const catalog = plannerRecipeCatalog();
        const result = calculatePlannerQueue();
        const groups = [...new Set(catalog.map(recipe => recipe.group))];
        const savedGroup = state.craftingPlanner?.selectedGroup;
        const selectedGroup = groups.includes(savedGroup)
            ? savedGroup
            : groups[0] || '';

        const groupRecipes = catalog.filter(
            recipe => recipe.group === selectedGroup
        );

        const savedRecipe = state.craftingPlanner?.selectedRecipe;
        const selectedRecipe =
            savedGroup &&
            groupRecipes.some(recipe => recipe.id === savedRecipe)
                ? savedRecipe
                : groupRecipes[0]?.id || '';

        return `
            <section class="tqm-card">
                <div class="tqm-section-heading-row">
                    <div>
                        <h2>Crafting Queue Planner</h2>
                        <p class="tqm-note">
                            Add finished quantities to a planned queue.
                            Quartermaster applies your mastery, current city
                            speed bonus, supply fees, Exchange tax, and captured
                            prices.
                        </p>
                    </div>

                    <button
                        class="tqm-action tqm-secondary"
                        id="tqm-planner-clear"
                        ${result.rows.length ? '' : 'disabled'}
                    >
                        Clear Queue
                    </button>
                </div>

                <div class="tqm-planner-add">
                    <label class="tqm-planner-type">
                        <span>Crafting Type</span>
                        <select id="tqm-planner-group">
                            ${groups.map(group => `
                                <option
                                    value="${escapeHtml(group)}"
                                    ${selectedGroup === group ? 'selected' : ''}
                                >
                                    ${escapeHtml(group)}
                                </option>
                            `).join('')}
                        </select>
                    </label>

                    <label class="tqm-planner-item">
                        <span>Item</span>
                        <select id="tqm-planner-recipe">
                            ${groupRecipes.map(recipe => `
                                <option
                                    value="${escapeHtml(recipe.id)}"
                                    ${selectedRecipe === recipe.id ? 'selected' : ''}
                                >
                                    ${escapeHtml(recipe.name)} · Lv. ${recipe.requiredLevel}
                                </option>
                            `).join('')}
                        </select>
                    </label>

                    <label class="tqm-planner-quantity">
                        <span>Finished Quantity</span>
                        <input
                            id="tqm-planner-quantity"
                            type="number"
                            min="1"
                            step="1"
                            value="${Math.max(
                                1,
                                Math.floor(
                                    Number(state.craftingPlanner?.quantity) || 1
                                )
                            )}"
                        >
                    </label>

                    <button class="tqm-action" id="tqm-planner-add">
                        Add to Queue
                    </button>
                </div>
            </section>

            <section class="tqm-card">
                <h2>Queue Summary</h2>

                <div class="tqm-summary-grid">
                    <div>
                        <span>Queue Entries</span>
                        <strong>${result.rows.length.toLocaleString()}</strong>
                    </div>
                    <div>
                        <span>Estimated Craft Time</span>
                        <strong>${formatSeconds(result.totalSeconds)}</strong>
                    </div>
                    <div>
                        <span>Total Supply Fees</span>
                        <strong>${formatGold(result.totalFees)}</strong>
                    </div>
                    <div>
                        <span>Projected Net Profit</span>
                        <strong class="${
                            result.totalProfitKnown >= 0
                                ? 'tqm-profit-positive'
                                : 'tqm-profit-negative'
                        }">
                            ${signedMoney(result.totalProfitKnown)}
                        </strong>
                        <small>
                            ${result.unknownProfitRows
                                ? `${result.unknownProfitRows} row(s) missing prices`
                                : 'All queue prices captured'}
                        </small>
                    </div>
                </div>

                ${result.lockedRows ? `
                    <p class="tqm-warning-note">
                        ${result.lockedRows} queue item(s) are above the detected
                        skill level.
                    </p>
                ` : ''}
            </section>

            <section class="tqm-card">
                <h2>Planned Queue</h2>

                <div class="tqm-table-wrap">
                    <table class="tqm-table tqm-table-compact">
                        <thead>
                            <tr>
                                <th>Craft</th>
                                <th>Wanted</th>
                                <th>Batches</th>
                                <th>Produced</th>
                                <th>Input Required</th>
                                <th>Supply Fees</th>
                                <th>Time</th>
                                <th>Projected Profit</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            ${result.rows.length
                                ? result.rows.map(row => row.missing ? `
                                    <tr>
                                        <td colspan="8">Unknown saved recipe</td>
                                        <td>
                                            <button
                                                class="tqm-mini-button"
                                                data-tqm-planner-remove="${row.index}"
                                            >
                                                Remove
                                            </button>
                                        </td>
                                    </tr>
                                ` : `
                                    <tr>
                                        <td>
                                            <strong>${escapeHtml(row.recipe.name)}</strong>
                                            <small>
                                                ${escapeHtml(
                                                    row.recipe.skill[0].toUpperCase() +
                                                    row.recipe.skill.slice(1)
                                                )} · Lv. ${row.recipe.requiredLevel}
                                                ${row.canCraft ? '' : ' · Locked'}
                                            </small>
                                        </td>
                                        <td>${row.quantity.toLocaleString()}</td>
                                        <td>${row.batches.toLocaleString()}</td>
                                        <td>${Number(row.produced).toLocaleString(
                                            undefined,
                                            { maximumFractionDigits: 2 }
                                        )}</td>
                                        <td>
                                            ${row.ingredientRows.map(ingredient => `
                                                <div class="tqm-planner-ingredient">
                                                    ${Number(ingredient.required).toLocaleString()}
                                                    <small>${escapeHtml(ingredient.name)}</small>
                                                </div>
                                            `).join('')}
                                        </td>
                                        <td>
                                            ${formatGold(row.feeTotal)}
                                            ${row.recipe.fuelLog ? `
                                                <small>${escapeHtml(row.recipe.fuelLog)}</small>
                                            ` : ''}
                                        </td>
                                        <td>${formatSeconds(row.seconds)}</td>
                                        <td class="${
                                            Number.isFinite(row.profit)
                                                ? row.profit >= 0
                                                    ? 'tqm-profit-positive'
                                                    : 'tqm-profit-negative'
                                                : ''
                                        }">
                                            ${Number.isFinite(row.profit)
                                                ? signedMoney(row.profit)
                                                : '—'}
                                        </td>
                                        <td>
                                            <button
                                                class="tqm-mini-button"
                                                data-tqm-planner-remove="${row.index}"
                                            >
                                                Remove
                                            </button>
                                        </td>
                                    </tr>
                                `).join('')
                                : `
                                    <tr>
                                        <td colspan="9" class="tqm-empty">
                                            No crafts have been added yet.
                                        </td>
                                    </tr>
                                `}
                        </tbody>
                    </table>
                </div>

                <p class="tqm-note">
                    Profit values compare selling the finished output against
                    selling all required input materials. Missing prices show
                    as — and are not included in the summary profit.
                </p>
            </section>
        `;
    }

    function positiveNumber(value) {
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    }

    function ceilNumber(value) {
        return Math.ceil(Math.max(0, Number(value) || 0));
    }

    function parseInventorySlotQuantity(slot) {
        const badge =
            slot.querySelector('.mp-badge-count') ||
            slot.querySelector('[class*="badge-count"]') ||
            slot.querySelector('[class*="slot-count"]');

        if (badge) {
            const rawText = normalizeName(badge.textContent);
            const quantity = numberFromText(rawText);

            if (quantity > 0) {
                return {
                    quantity,
                    rounded: /[km]\b/i.test(rawText)
                };
            }
        }

        const rawAttribute =
            slot.getAttribute('data-count') ||
            slot.getAttribute('data-quantity') ||
            '';
        const attributeQuantity = numberFromText(rawAttribute);

        return {
            quantity: attributeQuantity > 0
                ? attributeQuantity
                : 1,
            rounded: /[km]\b/i.test(String(rawAttribute))
        };
    }

    function scanInventoryGrid(selector, maximumSlots = 20) {
        const grid = document.querySelector(selector);
        if (!grid) return null;

        const slots = [
            ...grid.querySelectorAll(
                '.sp-hold-slot:not(.sp-hold-slot--empty)'
            )
        ].slice(0, maximumSlots);

        const items = {};
        let hasRoundedValues = false;

        slots.forEach(slot => {
            const itemName = normalizeName(
                slot.getAttribute('title') ||
                slot.querySelector('.sp-hold-slot-name')?.textContent ||
                ''
            );

            if (!itemName) return;

            const parsed = parseInventorySlotQuantity(slot);

            items[itemName] =
                (items[itemName] || 0) +
                Number(parsed.quantity || 0);

            if (parsed.rounded) {
                hasRoundedValues = true;
            }
        });

        return {
            items,
            hasRoundedValues
        };
    }

    function applyCachedInventoryToShipBuilder(force = false) {
        if (
            Boolean(state.shipBuilder?.manualInventoryOverride) &&
            !force
        ) {
            return false;
        }

        const wood = WOODS.includes(state.shipBuilder?.wood)
            ? state.shipBuilder.wood
            : 'Fenn';
        const metal = METALS.includes(state.shipBuilder?.metal)
            ? state.shipBuilder.metal
            : 'Darkiron';
        const items = state.inventoryCache?.items || {};

        state.shipBuilder = {
            ...state.shipBuilder,
            manualInventoryOverride: false,
            inventory: {
                ...DEFAULT_STATE.shipBuilder.inventory,
                ...(state.shipBuilder?.inventory || {}),
                logs: Number(items[`${wood} Log`] || 0),
                planks: Number(items[`${wood} Plank`] || 0),
                beams: Number(items[`${wood} Beam`] || 0),
                ore: Number(items[`${metal} Ore`] || 0),
                bars: Number(items[`${metal} Bar`] || 0),
                nails: Number(items[`${metal} Nails`] || 0)
            }
        };

        return true;
    }

    function inventoryMapsEqual(first, second) {
        const firstKeys = Object.keys(first || {}).sort();
        const secondKeys = Object.keys(second || {}).sort();

        return (
            firstKeys.length === secondKeys.length &&
            firstKeys.every(
                (key, index) =>
                    key === secondKeys[index] &&
                    Number(first[key] || 0) ===
                        Number(second[key] || 0)
            )
        );
    }

    function scanGameInventory(forceApplyToShipBuilder = false) {
        const preferences = {
            ...DEFAULT_STATE.preferences,
            ...(state.preferences || {})
        };
        const warehouseScan =
            preferences.includeWarehouseInventory
                ? scanInventoryGrid('#inv-wh-grid', 20)
                : null;
        const cargoScan =
            preferences.includeShipInventory
                ? scanInventoryGrid('#inv-cargo-grid', 20)
                : null;

        if (!warehouseScan && !cargoScan) {
            return false;
        }

        const warehouseItems = warehouseScan?.items || {};
        const cargoItems = cargoScan?.items || {};
        const combined = {};

        [warehouseItems, cargoItems].forEach(source => {
            Object.entries(source).forEach(([name, quantity]) => {
                combined[name] =
                    (combined[name] || 0) +
                    Number(quantity || 0);
            });
        });

        const hasRoundedValues = Boolean(
            warehouseScan?.hasRoundedValues ||
            cargoScan?.hasRoundedValues
        );
        const previous = state.inventoryCache?.items || {};
        const previousRounded = Boolean(
            state.inventoryCache?.hasRoundedValues
        );
        let changed =
            !inventoryMapsEqual(previous, combined) ||
            previousRounded !== hasRoundedValues;

        state.inventoryCache = {
            items: combined,
            warehouseItems,
            cargoItems,
            hasRoundedValues,
            updatedAt: changed
                ? Date.now()
                : Number(
                    state.inventoryCache?.updatedAt ||
                    Date.now()
                )
        };

        /*
         * Warehouses are per-city, and the Warehouse tab lets you browse a
         * city's warehouse remotely (without the ship being docked there),
         * so the docked-ship city (state.currentCity) is NOT a safe label
         * for which warehouse was just scanned. Read the warehouse tab's
         * own city switcher instead, falling back to the docked city only
         * when that switcher isn't on screen.
         */
        /*
         * No fallback to the docked city here on purpose: guessing was
         * what caused scans of one city's warehouse to get filed under
         * whichever city the ship happened to be docked at. Skip tagging
         * rather than mislabel when the warehouse panel's own city can't
         * be positively identified.
         */
        const warehouseCity = detectWarehouseCityFromPage();

        if (warehouseScan && warehouseCity) {
            const previousCity =
                state.cityInventories?.[warehouseCity]?.items || {};
            const cityChanged = !inventoryMapsEqual(
                previousCity,
                warehouseItems
            );

            state.cityInventories = {
                ...state.cityInventories,
                [warehouseCity]: {
                    items: warehouseItems,
                    hasRoundedValues: Boolean(warehouseScan.hasRoundedValues),
                    updatedAt: cityChanged
                        ? Date.now()
                        : Number(
                            state.cityInventories?.[warehouseCity]
                                ?.updatedAt || Date.now()
                        )
                }
            };

            changed = changed || cityChanged;
        }

        applyCachedInventoryToShipBuilder(forceApplyToShipBuilder);

        if (changed || forceApplyToShipBuilder) {
            saveState();
        }

        return changed;
    }

    function combinedNetWorthItems() {
        const combined = {};

        const addAll = source => {
            Object.entries(source || {}).forEach(([name, quantity]) => {
                combined[name] =
                    (combined[name] || 0) + Number(quantity || 0);
            });
        };

        Object.values(state.cityInventories || {}).forEach(city => {
            addAll(city?.items);
        });

        addAll(state.inventoryCache?.cargoItems);

        return combined;
    }

    function computeInventoryValue() {
        const items = combinedNetWorthItems();
        let total = 0;
        let pricedCount = 0;
        let unpricedCount = 0;

        Object.entries(items).forEach(([name, quantity]) => {
            const count = Number(quantity) || 0;
            if (!(count > 0)) return;

            const record = sharedPriceRecord(name);
            const sale = record ? bestSaleValue(record, count) : null;

            if (sale && Number.isFinite(sale.value) && sale.value > 0) {
                total += sale.value;
                pricedCount += 1;
            } else {
                unpricedCount += 1;
            }
        });

        return { total, pricedCount, unpricedCount };
    }

    function readPlayerGold() {
        const el = document.getElementById('hdr-gold-val');
        if (!el) return null;

        const value = numberFromText(el.textContent);
        return Number.isFinite(value) ? value : null;
    }

    function computeNetWorth() {
        const inventory = computeInventoryValue();
        const gold = readPlayerGold();
        const goldKnown = Number.isFinite(gold);

        return {
            total: inventory.total + (goldKnown ? gold : 0),
            invValue: inventory.total,
            gold: goldKnown ? gold : 0,
            goldKnown,
            pricedCount: inventory.pricedCount,
            unpricedCount: inventory.unpricedCount
        };
    }

    /*
     * Snapshots are throttled to one per NET_WORTH_SNAPSHOT_INTERVAL_MS and
     * skipped entirely until gold is readable or at least one item has a
     * usable price, so a fresh install doesn't fill the history with zeroes.
     */
    function recordNetWorthSnapshot(force = false) {
        const { total, pricedCount, goldKnown } = computeNetWorth();
        if (!goldKnown && pricedCount === 0 && !force) return false;

        const history = Array.isArray(state.netWorthHistory)
            ? state.netWorthHistory
            : [];
        const last = history[history.length - 1];

        if (
            !force &&
            last &&
            Date.now() - last.t < NET_WORTH_SNAPSHOT_INTERVAL_MS
        ) {
            return false;
        }

        const next = [...history, { t: Date.now(), v: Math.round(total) }];

        state.netWorthHistory =
            next.length > NET_WORTH_HISTORY_MAX_POINTS
                ? next.slice(next.length - NET_WORTH_HISTORY_MAX_POINTS)
                : next;

        saveState();
        return true;
    }

    function netWorthHistoryPointsForRange(rangeId) {
        const history = Array.isArray(state.netWorthHistory)
            ? state.netWorthHistory
            : [];
        const range =
            NET_WORTH_RANGE_OPTIONS.find(option => option.id === rangeId) ||
            NET_WORTH_RANGE_OPTIONS[1];
        const cutoff = Number.isFinite(range.ms) ? Date.now() - range.ms : 0;

        return history.filter(point => point.t >= cutoff);
    }

    function closestNetWorthPoint(history, targetTime) {
        if (!history.length) return null;

        return history.reduce((closest, point) => {
            if (!closest) return point;

            return Math.abs(point.t - targetTime) <
                Math.abs(closest.t - targetTime)
                ? point
                : closest;
        }, null);
    }

    function downsampleNetWorthPoints(points, maxPoints = 220) {
        if (points.length <= maxPoints) return points;

        const stride = points.length / maxPoints;
        const sampled = [];

        for (let index = 0; index < maxPoints; index += 1) {
            sampled.push(points[Math.floor(index * stride)]);
        }

        const last = points[points.length - 1];
        if (sampled[sampled.length - 1] !== last) sampled.push(last);

        return sampled;
    }

    function buildNetWorthSparkline(points, width = 760, height = 200) {
        if (points.length < 2) return null;

        const values = points.map(point => point.v);
        const minValue = Math.min(...values);
        const maxValue = Math.max(...values);
        const span = maxValue - minValue || 1;
        const stepX = width / (points.length - 1);

        const coords = points.map((point, index) => [
            index * stepX,
            height - ((point.v - minValue) / span) * height
        ]);

        const linePath = coords
            .map(
                ([x, y], index) =>
                    `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
            )
            .join(' ');

        const areaPath =
            `${linePath} L${width.toFixed(1)},${height.toFixed(1)} ` +
            `L0,${height.toFixed(1)} Z`;

        return { linePath, areaPath, minValue, maxValue, width, height };
    }

    function calculateShipBuild() {
        applyCachedInventoryToShipBuilder();

        const build = state.shipBuilder || DEFAULT_STATE.shipBuilder;
        const inventory = {
            ...DEFAULT_STATE.shipBuilder.inventory,
            ...(build.inventory || {})
        };

        const wood = WOODS.includes(build.wood) ? build.wood : 'Fenn';
        const metal = METALS.includes(build.metal) ? build.metal : 'Darkiron';

        const requiredPlanks = positiveNumber(build.planks);
        const requiredBeams = positiveNumber(build.beams);
        const requiredNails = positiveNumber(build.nails);
        const shipwrightFee = positiveNumber(build.shipwrightFee);

        const haveLogs = positiveNumber(inventory.logs);
        const haveOre = positiveNumber(inventory.ore);
        const haveBars = positiveNumber(inventory.bars);
        const haveNails = positiveNumber(inventory.nails);
        const havePlanks = positiveNumber(inventory.planks);
        const haveBeams = positiveNumber(inventory.beams);

        const carpentryYield = yieldMultiplier('carpentry');
        const smeltingYield = yieldMultiplier('smelting');
        const craftingYield = yieldMultiplier('crafting');

        /*
         * Existing finished materials are applied first. Any excess planks
         * can then be consumed while crafting missing beams.
         */
        const remainingBeams = Math.max(0, requiredBeams - haveBeams);
        const remainingFinishedPlanks = Math.max(0, requiredPlanks - havePlanks);
        const sparePlanks = Math.max(0, havePlanks - requiredPlanks);

        const beamActions = remainingBeams / carpentryYield;
        const planksConsumedForBeams = beamActions * 2;
        const remainingBeamPlankInput = Math.max(
            0,
            planksConsumedForBeams - sparePlanks
        );

        const totalPlankOutputNeeded =
            remainingFinishedPlanks + remainingBeamPlankInput;

        const logActions = totalPlankOutputNeeded / carpentryYield;
        const totalLogsNeeded = ceilNumber(logActions);
        const remainingLogs = Math.max(0, totalLogsNeeded - haveLogs);

        /*
         * Nails are made from bars. Existing nails are used first, followed
         * by existing bars, then existing ore.
         */
        const remainingNails = Math.max(0, requiredNails - haveNails);
        const nailOutputPerBar = 4 * craftingYield;
        const totalBarsNeeded = ceilNumber(
            nailOutputPerBar > 0
                ? remainingNails / nailOutputPerBar
                : 0
        );

        const remainingBars = Math.max(0, totalBarsNeeded - haveBars);
        const totalOreNeeded = ceilNumber(
            smeltingYield > 0
                ? (remainingBars * 2) / smeltingYield
                : 0
        );
        const remainingOre = Math.max(0, totalOreNeeded - haveOre);

        const logRecord = findItemPrice([`${wood} Log`, `${wood} Logs`]);
        const plankRecord = findItemPrice([`${wood} Plank`, `${wood} Planks`]);
        const beamRecord = findItemPrice([`${wood} Beam`, `${wood} Beams`]);
        const oreRecord = findItemPrice([`${metal} Ore`]);
        const barRecord = findItemPrice([`${metal} Bar`, `${metal} Bars`]);
        const nailRecord = findItemPrice([`${metal} Nail`, `${metal} Nails`]);

        /*
         * Build-cost comparisons represent actually buying materials, so they
         * require active Exchange sell listings. Vendor values and buy orders
         * are not purchase prices and must not make a missing listing look free.
         */
        const logPrice = chosenMarketPrice(logRecord);
        const plankPrice = chosenMarketPrice(plankRecord);
        const beamPrice = chosenMarketPrice(beamRecord);
        const orePrice = chosenMarketPrice(oreRecord);
        const barPrice = chosenMarketPrice(barRecord);
        const nailPrice = chosenMarketPrice(nailRecord);

        const smeltingSupplyFee = Number(
            SMELTING_SUPPLY_FEES[metal]?.fee || 0
        );
        const smeltingActions = smeltingYield > 0
            ? remainingBars / smeltingYield
            : 0;
        const smeltingFees = smeltingActions * smeltingSupplyFee;

        const missingPrices = (requirements) => requirements
            .filter(entry => entry.quantity > 0 && !(entry.price > 0))
            .map(entry => entry.name);

        const rawMissingPrices = missingPrices([
            {
                name: `${wood} Logs`,
                quantity: remainingLogs,
                price: logPrice
            },
            {
                name: `${metal} Ore`,
                quantity: remainingOre,
                price: orePrice
            }
        ]);
        const intermediateMissingPrices = missingPrices([
            {
                name: `${wood} Planks`,
                quantity: remainingFinishedPlanks,
                price: plankPrice
            },
            {
                name: `${wood} Beams`,
                quantity: remainingBeams,
                price: beamPrice
            },
            {
                name: `${metal} Bars`,
                quantity: remainingBars,
                price: barPrice
            }
        ]);
        const finishedMissingPrices = missingPrices([
            {
                name: `${wood} Planks`,
                quantity: remainingFinishedPlanks,
                price: plankPrice
            },
            {
                name: `${wood} Beams`,
                quantity: remainingBeams,
                price: beamPrice
            },
            {
                name: `${metal} Nails`,
                quantity: remainingNails,
                price: nailPrice
            }
        ]);

        const rawMaterialCost = rawMissingPrices.length
            ? NaN
            : remainingLogs * logPrice +
                remainingOre * orePrice +
                smeltingFees +
                shipwrightFee;

        const intermediateMaterialCost = intermediateMissingPrices.length
            ? NaN
            : remainingFinishedPlanks * plankPrice +
                remainingBeams * beamPrice +
                remainingBars * barPrice +
                shipwrightFee;

        const finishedMaterialCost = finishedMissingPrices.length
            ? NaN
            : remainingFinishedPlanks * plankPrice +
                remainingBeams * beamPrice +
                remainingNails * nailPrice +
                shipwrightFee;

        const plankTime = adjustedCraftTime(
            WOOD_CRAFT_TIMES[wood]?.plank || 0,
            'carpentry'
        );
        const beamTime = adjustedCraftTime(
            WOOD_CRAFT_TIMES[wood]?.beam || 0,
            'carpentry'
        );
        const barTime = adjustedCraftTime(
            METAL_CRAFT_TIMES[metal]?.bar || 0,
            'smelting'
        );
        const nailTime = adjustedCraftTime(
            METAL_CRAFT_TIMES[metal]?.nail || 0,
            'crafting'
        );

        /*
         * Owned ore reduces what must be purchased, but it still has to be
         * smelted. Every bar not already owned therefore contributes smelting
         * time and its supply fee.
         */
        const barsToSmelt = remainingBars;

        const totalCraftSeconds =
            logActions * plankTime +
            beamActions * beamTime +
            smeltingActions * barTime +
            (remainingNails / nailOutputPerBar) * nailTime;

        return {
            ...build,
            inventory,
            presetBuildTime:
                SHIP_PRESETS[build.selectedShip]?.buildTime || '',
            wood,
            metal,
            requiredPlanks,
            requiredBeams,
            requiredNails,
            shipwrightFee,
            haveLogs,
            haveOre,
            haveBars,
            haveNails,
            havePlanks,
            haveBeams,
            carpentryYield,
            smeltingYield,
            craftingYield,
            beamActions,
            planksConsumedForBeams,
            remainingBeamPlankInput,
            totalPlankOutputNeeded,
            totalLogsNeeded,
            remainingLogs,
            remainingFinishedPlanks,
            remainingBeams,
            remainingNails,
            totalBarsNeeded,
            remainingBars,
            totalOreNeeded,
            remainingOre,
            logPrice,
            plankPrice,
            beamPrice,
            orePrice,
            barPrice,
            nailPrice,
            smeltingSupplyFee,
            smeltingActions,
            smeltingFees,
            rawMissingPrices,
            intermediateMissingPrices,
            finishedMissingPrices,
            rawMaterialCost,
            finishedMaterialCost,
            intermediateMaterialCost,
            totalCraftSeconds
        };
    }

    function renderShipBuilder() {
        const result = calculateShipBuild();
        const formatBuildCost = value => Number.isFinite(value)
            ? formatGold(value, { allowZero: true })
            : 'N/A';
        const missingListingText = missing => missing.length
            ? `Missing Exchange listings: ${missing.join(', ')}`
            : '';

        return `
            <div class="tqm-ship-builder-grid">
            <section class="tqm-card tqm-ship-config-card">
                <div class="tqm-section-heading-row">
                    <div>
                        <h2>Ship Builder</h2>
                        <p class="tqm-note">
                            Load a ship blueprint or build your own.
                            Materials, crafting time, and costs update automatically.
                        </p>
                    </div>

                    <div class="tqm-ship-heading-actions">
                        <button
                            class="tqm-action tqm-secondary"
                            id="tqm-toggle-inventory-panel"
                            type="button"
                        >
                            Inventory
                        </button>

                        <div class="tqm-best-port-badge">
                            <span>Current Build</span>
                            <strong>${escapeHtml(result.name || 'Custom Ship')}</strong>
                        </div>
                    </div>
                </div>

                <div class="tqm-ship-form">
                    <label class="tqm-ship-preset-field">
                        <span>Ship</span>
                        <select id="tqm-ship-preset">
                            <option value="Custom"
                                ${!SHIP_PRESETS[result.selectedShip] ? 'selected' : ''}>
                                Custom
                            </option>
                            ${Object.keys(SHIP_PRESETS).map(ship => `
                                <option value="${escapeHtml(ship)}"
                                    ${ship === result.selectedShip ? 'selected' : ''}>
                                    ${escapeHtml(ship)}
                                </option>
                            `).join('')}
                        </select>
                    </label>

                    <label>
                        <span>Wood Tier</span>
                        <select id="tqm-ship-wood">
                            ${WOODS.map(wood => `
                                <option value="${escapeHtml(wood)}"
                                    ${wood === result.wood ? 'selected' : ''}>
                                    ${escapeHtml(wood)}
                                </option>
                            `).join('')}
                        </select>
                    </label>

                    <label>
                        <span>Metal Tier</span>
                        <select id="tqm-ship-metal">
                            ${METALS.map(metal => `
                                <option value="${escapeHtml(metal)}"
                                    ${metal === result.metal ? 'selected' : ''}>
                                    ${escapeHtml(metal)}
                                </option>
                            `).join('')}
                        </select>
                    </label>

                    <label>
                        <span>Finished Planks</span>
                        <input id="tqm-ship-planks" type="number" min="0" step="1"
                            value="${result.requiredPlanks}">
                    </label>

                    <label>
                        <span>Finished Beams</span>
                        <input id="tqm-ship-beams" type="number" min="0" step="1"
                            value="${result.requiredBeams}">
                    </label>

                    <label>
                        <span>Finished Nails</span>
                        <input id="tqm-ship-nails" type="number" min="0" step="1"
                            value="${result.requiredNails}">
                    </label>

                    <label>
                        <span>Shipwright Fee</span>
                        <input id="tqm-ship-fee" type="number" min="0" step="1"
                            value="${result.shipwrightFee}">
                    </label>
                </div>
            </section>

            <div class="tqm-ship-materials-layout">
                <section class="tqm-card">
                    <div class="tqm-section-heading-row tqm-compact-heading">
                        <div>
                            <h2>Materials I Already Have</h2>
                            <p class="tqm-note">
                                Finished materials are used before converting raw materials.
                            </p>
                        </div>

                        <button
                            class="tqm-action tqm-secondary tqm-clear-materials"
                            id="tqm-clear-ship-inventory"
                            type="button"
                        >
                            Clear
                        </button>
                    </div>

                    <div class="tqm-material-columns">
                        <div class="tqm-material-column">
                            <label>
                                <span>${escapeHtml(result.wood)} Logs</span>
                                <input id="tqm-have-logs" type="number" min="0" step="1"
                                    value="${result.haveLogs}">
                            </label>

                            <label>
                                <span>${escapeHtml(result.wood)} Planks</span>
                                <input id="tqm-have-planks" type="number" min="0" step="1"
                                    value="${result.havePlanks}">
                            </label>

                            <label>
                                <span>${escapeHtml(result.wood)} Beams</span>
                                <input id="tqm-have-beams" type="number" min="0" step="1"
                                    value="${result.haveBeams}">
                            </label>
                        </div>

                        <div class="tqm-material-column">
                            <label>
                                <span>${escapeHtml(result.metal)} Ore</span>
                                <input id="tqm-have-ore" type="number" min="0" step="1"
                                    value="${result.haveOre}">
                            </label>

                            <label>
                                <span>${escapeHtml(result.metal)} Bars</span>
                                <input id="tqm-have-bars" type="number" min="0" step="1"
                                    value="${result.haveBars}">
                            </label>

                            <label>
                                <span>${escapeHtml(result.metal)} Nails</span>
                                <input id="tqm-have-nails" type="number" min="0" step="1"
                                    value="${result.haveNails}">
                            </label>
                        </div>
                    </div>
                </section>

                <section class="tqm-card">
                    <h2>Remaining Requirements by Build Path</h2>

                    <div class="tqm-material-columns tqm-material-summary">
                        <div class="tqm-material-column">
                            <div class="${result.remainingLogs <= 0 ? 'tqm-state-positive' : 'tqm-state-warning'}">
                                <span>Raw Path · ${escapeHtml(result.wood)} Logs</span>
                                <strong>${result.remainingLogs.toLocaleString()}</strong>
                            </div>
                            <div class="${result.remainingFinishedPlanks <= 0 ? 'tqm-state-positive' : 'tqm-state-warning'}">
                                <span>Finished · ${escapeHtml(result.wood)} Planks</span>
                                <strong>${result.remainingFinishedPlanks.toLocaleString()}</strong>
                            </div>
                            <div class="${result.remainingBeams <= 0 ? 'tqm-state-positive' : 'tqm-state-warning'}">
                                <span>Finished · ${escapeHtml(result.wood)} Beams</span>
                                <strong>${result.remainingBeams.toLocaleString()}</strong>
                            </div>
                        </div>

                        <div class="tqm-material-column">
                            <div class="${result.remainingOre <= 0 ? 'tqm-state-positive' : 'tqm-state-warning'}">
                                <span>Raw Path · ${escapeHtml(result.metal)} Ore</span>
                                <strong>${result.remainingOre.toLocaleString()}</strong>
                            </div>
                            <div class="${result.remainingBars <= 0 ? 'tqm-state-positive' : 'tqm-state-warning'}">
                                <span>Intermediate · ${escapeHtml(result.metal)} Bars</span>
                                <strong>${result.remainingBars.toLocaleString()}</strong>
                            </div>
                            <div class="${result.remainingNails <= 0 ? 'tqm-state-positive' : 'tqm-state-warning'}">
                                <span>Finished · ${escapeHtml(result.metal)} Nails</span>
                                <strong>${result.remainingNails.toLocaleString()}</strong>
                            </div>
                        </div>
                    </div>

                    <div class="tqm-time-summary">
                        <div>
                            <span>Estimated Craft Time</span>
                            <strong>${formatSeconds(result.totalCraftSeconds)}</strong>
                        </div>
                        <div>
                            <span>Official Shipyard Build Time</span>
                            <strong>${escapeHtml(result.presetBuildTime || 'Custom')}</strong>
                        </div>
                    </div>
                </section>
            </div>

            </div>

            ${result.inventoryPanelOpen ? `
                <aside
                    class="tqm-floating-inventory"
                    id="tqm-floating-inventory"
                    style="
                        left: ${Math.max(
                            12,
                            Number(
                                result.inventoryPanelPosition?.left || 80
                            )
                        )}px;
                        top: ${Math.max(
                            12,
                            Number(
                                result.inventoryPanelPosition?.top || 120
                            )
                        )}px;
                    "
                >
                    <div
                        class="tqm-floating-inventory-header"
                        id="tqm-floating-inventory-drag"
                    >
                        <div>
                            <span>Ship Planner</span>
                            <strong>Inventory</strong>
                        </div>

                        <div class="tqm-floating-inventory-header-actions">
                            <button
                                id="tqm-refresh-inventory-panel"
                                type="button"
                                title="Refresh inventory scan"
                                aria-label="Refresh inventory scan"
                            >
                                ↻
                            </button>

                            <button
                                id="tqm-close-inventory-panel"
                                type="button"
                                aria-label="Close inventory"
                            >
                                ×
                            </button>
                        </div>
                    </div>

                    <div class="tqm-floating-inventory-body">
                        <section>
                            <h3>${escapeHtml(result.wood)}</h3>

                            <label>
                                <span>Logs</span>
                                <input
                                    data-tqm-floating-inventory="logs"
                                    type="number"
                                    min="0"
                                    step="1"
                                    value="${result.haveLogs}"
                                >
                            </label>

                            <label>
                                <span>Planks</span>
                                <input
                                    data-tqm-floating-inventory="planks"
                                    type="number"
                                    min="0"
                                    step="1"
                                    value="${result.havePlanks}"
                                >
                            </label>

                            <label>
                                <span>Beams</span>
                                <input
                                    data-tqm-floating-inventory="beams"
                                    type="number"
                                    min="0"
                                    step="1"
                                    value="${result.haveBeams}"
                                >
                            </label>
                        </section>

                        <section>
                            <h3>${escapeHtml(result.metal)}</h3>

                            <label>
                                <span>Ore</span>
                                <input
                                    data-tqm-floating-inventory="ore"
                                    type="number"
                                    min="0"
                                    step="1"
                                    value="${result.haveOre}"
                                >
                            </label>

                            <label>
                                <span>Bars</span>
                                <input
                                    data-tqm-floating-inventory="bars"
                                    type="number"
                                    min="0"
                                    step="1"
                                    value="${result.haveBars}"
                                >
                            </label>

                            <label>
                                <span>Nails</span>
                                <input
                                    data-tqm-floating-inventory="nails"
                                    type="number"
                                    min="0"
                                    step="1"
                                    value="${result.haveNails}"
                                >
                            </label>
                        </section>
                    </div>

                    <div class="tqm-floating-inventory-footer">
                        <span class="tqm-floating-inventory-footer-title">
                            Inventory Scan
                        </span>

                        <span>
                            Warehouse + current ship cargo only.
                        </span>

                        ${
                            state.inventoryCache?.hasRoundedValues
                                ? `
                                    <span class="tqm-inventory-rounded-warning">
                                        Large stacks (1K+) are rounded by Tidefall.
                                        Example: 7.9K is read as approximately 7,900.
                                    </span>
                                `
                                : ''
                        }

                        <strong>
                            ${
                                state.inventoryCache?.updatedAt
                                    ? `Last scan ${new Date(
                                        state.inventoryCache.updatedAt
                                    ).toLocaleTimeString([], {
                                        hour: 'numeric',
                                        minute: '2-digit'
                                    })}`
                                    : 'Open Inventory to scan items'
                            }
                        </strong>
                    </div>
                </aside>
            ` : ''}

            <section class="tqm-card">
                <h2>Build Cost Comparison</h2>

                <div class="tqm-table-wrap">
                    <table class="tqm-table tqm-table-compact">
                        <thead>
                            <tr>
                                <th>Method</th>
                                <th>Estimated Cost</th>
                                <th>Included</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td><strong>Buy Raw Materials</strong></td>
                                <td>${formatBuildCost(result.rawMaterialCost)}</td>
                                <td>
                                    ${result.rawMissingPrices.length
                                        ? escapeHtml(missingListingText(result.rawMissingPrices))
                                        : `${result.remainingLogs.toLocaleString()} ${escapeHtml(result.wood)} Logs,
                                            ${result.remainingOre.toLocaleString()} ${escapeHtml(result.metal)} Ore,
                                            ${formatGold(result.smeltingFees, { allowZero: true })} smelting fees,
                                            shipwright fee`}
                                </td>
                            </tr>
                            <tr>
                                <td><strong>Buy Planks, Beams, and Bars</strong></td>
                                <td>${formatBuildCost(result.intermediateMaterialCost)}</td>
                                <td>
                                    ${result.intermediateMissingPrices.length
                                        ? escapeHtml(missingListingText(result.intermediateMissingPrices))
                                        : `Remaining finished wood, ${result.remainingBars.toLocaleString()} bars,
                                            nail crafting, shipwright fee`}
                                </td>
                            </tr>
                            <tr>
                                <td><strong>Buy All Finished Materials</strong></td>
                                <td>${formatBuildCost(result.finishedMaterialCost)}</td>
                                <td>
                                    ${result.finishedMissingPrices.length
                                        ? escapeHtml(missingListingText(result.finishedMissingPrices))
                                        : `Planks, beams, nails, shipwright fee`}
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <p class="tqm-note">
                    Costs use the lowest active Exchange sell listing. If any
                    required item has no listing, that method shows N/A instead
                    of treating the missing material as free. The raw-material
                    method includes smelting supply fees and the shipwright fee.
                </p>
            </section>
        `;
    }

    function renderXpPlanner() {
        const skillOrder = new Map(
            SUPPORTED_XP_SKILLS.map((skill, index) => [skill, index])
        );
        const rows = calculateXpRows()
            .filter(row => SUPPORTED_XP_SKILLS.includes(row.skill))
            .sort((a, b) =>
                Number(skillOrder.get(a.skill) ?? 999) -
                    Number(skillOrder.get(b.skill) ?? 999) ||
                Number(a.level || 0) - Number(b.level || 0) ||
                String(a.item).localeCompare(String(b.item))
            );
        const plan = calculateProgressPlan();
        const selectedSkill = plan?.skill || 'smelting';
        const selectedSkillLabel =
            selectedSkill[0].toUpperCase() + selectedSkill.slice(1);
        const selectedRecipe = plan?.recipe || null;
        const hasProgressOverride = Boolean(
            progressPlannerSessionOverrides[selectedSkill]
        );
        const skillRecipes = rows
            .filter(row => row.skill === selectedSkill)
            .sort((a, b) =>
                Number(a.level || 0) - Number(b.level || 0) ||
                String(a.item).localeCompare(String(b.item))
            );
        const currentSkillLevel = Math.max(
            1,
            Number(state.skillLevels[selectedSkill] || 1)
        );
        const top = [...skillRecipes]
            .filter(row =>
                !state.excludeLockedCrafts ||
                Number(row.level || 1) <= currentSkillLevel
            )
            .sort((a, b) => {
                const aRate =
                    a.xp * 3600 /
                    adjustedCraftTime(a.cycle, a.skill);
                const bRate =
                    b.xp * 3600 /
                    adjustedCraftTime(b.cycle, b.skill);

                return bRate - aRate;
            })[0] || skillRecipes[0] || null;

        return `
            <section class="tqm-card">
                <div class="tqm-section-heading-row">
                    <div>
                        <h2>Progress Planner</h2>
                        <p class="tqm-note">
                            Choose a profession, an action, and a target level.
                            Quartermaster uses your detected current level and XP
                            progress to calculate actions, time, and materials.
                        </p>
                    </div>

                    <div class="tqm-best-port-badge">
                        <span>
                            Best ${escapeHtml(
                                selectedSkill[0].toUpperCase() +
                                selectedSkill.slice(1)
                            )} XP / HR
                        </span>
                        <strong>${top ? escapeHtml(top.item) : 'No XP data'}</strong>
                        <small>
                            ${top
                                ? formatXpPerHour(
                                    top.xp * 3600 /
                                    adjustedCraftTime(top.cycle, top.skill)
                                )
                                : '—'}
                        </small>
                    </div>
                </div>

                <div class="tqm-progress-controls">
                    <label>
                        <span>Profession</span>
                        <select id="tqm-progress-skill">
                            ${SUPPORTED_XP_SKILLS.map(skill => `
                                <option value="${skill}" ${skill === selectedSkill ? 'selected' : ''}>
                                    ${escapeHtml(skill[0].toUpperCase() + skill.slice(1))}
                                </option>
                            `).join('')}
                        </select>
                    </label>

                    <label>
                        <span>Item / Action</span>
                        <select id="tqm-progress-item">
                            ${skillRecipes.map(recipe => {
                                const key = xpRecipeKey(recipe.skill, recipe.item);
                                return `
                                    <option value="${escapeHtml(key)}" ${
                                        selectedRecipe &&
                                        key === xpRecipeKey(selectedRecipe.skill, selectedRecipe.item)
                                            ? 'selected'
                                            : ''
                                    }>
                                        ${escapeHtml(recipe.item)} · ${recipe.xp} XP${
                                            Number(recipe.level || 1) >
                                            Number(plan?.currentLevel || 1)
                                                ? ` · Unlocks Lv. ${recipe.level}`
                                                : ''
                                        }
                                    </option>
                                `;
                            }).join('')}
                        </select>
                    </label>

                    <label>
                        <span>Current Level</span>
                        <input
                            id="tqm-progress-current-level"
                            type="number"
                            min="1"
                            max="200"
                            step="1"
                            value="${plan?.currentLevel || 1}"
                        >
                    </label>

                    <label>
                        <span>Current XP</span>
                        <div class="tqm-progress-input-inline">
                            <input
                                id="tqm-progress-current-xp"
                                type="number"
                                min="0"
                                max="${Math.max(0, xpRequiredForLevel(plan?.currentLevel || 1) - 1)}"
                                step="1"
                                value="${plan?.currentXp || 0}"
                            >
                            ${hasProgressOverride ? `
                                <button
                                    class="tqm-progress-restore"
                                    id="tqm-progress-use-detected"
                                    type="button"
                                    title="Restore detected level and XP"
                                    aria-label="Restore detected level and XP"
                                >
                                    ↺ Restore
                                </button>
                            ` : ''}
                        </div>
                    </label>

                    <label>
                        <span>Target Level</span>
                        <input
                            id="tqm-progress-target"
                            type="number"
                            min="${(plan?.currentLevel || 1) + 1}"
                            max="200"
                            step="1"
                            value="${plan?.targetLevel || 2}"
                        >
                    </label>
                </div>

                ${plan ? `
                    <div class="tqm-progress-divider"></div>

                    <div class="tqm-progress-goal-heading">
                        <h3>${plan.staged ? 'Staged Level Plan' : 'Level Goal'}</h3>
                        <span>
                            ${escapeHtml(plan.recipe.item)}
                            ${
                                !plan.selectedUsed
                                    ? ` · Unlocks at Lv. ${plan.selectedUnlockLevel}`
                                    : ''
                            }
                        </span>
                    </div>

                    <div class="tqm-summary-grid tqm-progress-summary">
                        <div>
                            <span>Progress</span>
                            <strong>Lv. ${plan.currentLevel} → ${plan.targetLevel}</strong>
                        </div>
                        <div>
                            <span>XP Required</span>
                            <strong>${Math.ceil(plan.xpNeeded).toLocaleString()} XP</strong>
                        </div>
                        <div>
                            <span>Total Actions</span>
                            <strong>${plan.actions.toLocaleString()}</strong>
                        </div>
                        <div>
                            <span>${selectedSkillLabel} Time</span>
                            <strong>${formatSeconds(plan.totalSeconds)}</strong>
                        </div>
                        ${plan.gatheringPlan.length ? `
                            <div>
                                <span>Gathering Time</span>
                                <strong>${formatSeconds(plan.gatheringSeconds)}</strong>
                            </div>
                            <div>
                                <span>Combined Time</span>
                                <strong>${formatSeconds(plan.combinedSeconds)}</strong>
                            </div>
                        ` : ''}
                        <div>
                            <span>Stages</span>
                            <strong>${plan.stages.length.toLocaleString()}</strong>
                        </div>
                        <div>
                            <span>${plan.selectedUsed ? 'Selected Action XP / HR' : 'Selected Action'}</span>
                            <strong>
                                ${plan.selectedUsed
                                    ? formatXpPerHour(plan.recipe.xpPerHour)
                                    : `Unavailable before target · Unlocks at Lv. ${plan.selectedUnlockLevel}`}
                            </strong>
                        </div>
                    </div>

                    ${plan.stages.length ? `
                        <div class="tqm-table-wrap" style="margin-top: 14px;">
                            <table class="tqm-table tqm-table-compact">
                                <thead>
                                    <tr>
                                        <th>Stage</th>
                                        <th>Levels</th>
                                        <th>Action</th>
                                        <th>XP / Action</th>
                                        <th>Actions</th>
                                        <th>Time</th>
                                        <th>Direct Input</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${plan.stages.map((stage, index) => `
                                        <tr>
                                            <td>${index + 1}</td>
                                            <td>Lv. ${stage.startLevel} → ${stage.targetLevel}</td>
                                            <td>
                                                <strong>${escapeHtml(stage.recipe.item)}</strong>
                                                ${stage.isSelectedRecipe
                                                    ? '<small>Selected action</small>'
                                                    : '<small>Best unlocked action</small>'}
                                            </td>
                                            <td>${stage.recipe.xp.toLocaleString()} XP</td>
                                            <td>${stage.actions.toLocaleString()}</td>
                                            <td>${formatSeconds(stage.totalSeconds)}</td>
                                            <td>
                                                ${stage.directIngredients.length
                                                    ? stage.directIngredients.map(ingredient =>
                                                        `${Math.ceil(ingredient.quantity).toLocaleString()} ${escapeHtml(ingredient.name)}`
                                                    ).join('<br>')
                                                    : 'None'}
                                            </td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    ` : ''}
                ` : ''}
            </section>

            ${plan ? `
                <div class="tqm-grid tqm-grid-2 tqm-material-result-grid">
                    <section class="tqm-card">
                        <div class="tqm-material-result-heading">
                            <h2>Required Inputs</h2>
                            <p class="tqm-note">
                                Combined materials consumed across every stage in the plan.
                            </p>
                        </div>

                        <div class="tqm-material-result-list">
                            ${
                                plan.directIngredients.length
                                    ? plan.directIngredients.map(ingredient => `
                                        <div class="tqm-material-result-item">
                                            <span>${escapeHtml(ingredient.name)}</span>
                                            <strong>${Math.ceil(ingredient.quantity).toLocaleString()}</strong>
                                        </div>
                                    `).join('')
                                    : `
                                        <div class="tqm-material-empty">
                                            No input material is required for this gathering action.
                                        </div>
                                    `
                            }
                        </div>
                    </section>

                    <section class="tqm-card">
                        <div class="tqm-material-result-heading">
                            <h2>${plan.gatheringPlan.length ? 'Gathering Plan' : 'Raw Resources to Gather'}</h2>
                            <p class="tqm-note">
                                ${plan.gatheringPlan.length
                                    ? 'Gathering actions use current yield mastery and city speed. Required bait or other gathering inputs are shown separately.'
                                    : 'Intermediate recipes are reduced to their original resources.'}
                            </p>
                        </div>

                        ${plan.gatheringPlan.length ? `
                            <div class="tqm-table-wrap">
                                <table class="tqm-table tqm-table-compact">
                                    <thead>
                                        <tr>
                                            <th>Resource</th>
                                            <th>Required</th>
                                            <th>Yield / Action</th>
                                            <th>Gathering Actions</th>
                                            <th>Gathering Time</th>
                                            <th>Inputs</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${plan.gatheringPlan.map(entry => `
                                            <tr>
                                                <td>
                                                    <strong>${escapeHtml(entry.item)}</strong>
                                                    <small>${escapeHtml(
                                                        entry.skill[0].toUpperCase() +
                                                        entry.skill.slice(1)
                                                    )}</small>
                                                </td>
                                                <td>${Math.ceil(entry.requiredQuantity).toLocaleString()}</td>
                                                <td>${Number(entry.yieldPerAction).toFixed(2)}</td>
                                                <td>${entry.actions.toLocaleString()}</td>
                                                <td>${formatSeconds(entry.totalSeconds)}</td>
                                                <td>
                                                    ${entry.inputs.length
                                                        ? entry.inputs.map(input =>
                                                            `${Math.ceil(input.quantity).toLocaleString()} ${escapeHtml(input.name)}`
                                                        ).join('<br>')
                                                        : 'None'}
                                                </td>
                                            </tr>
                                        `).join('')}
                                    </tbody>
                                </table>
                            </div>
                        ` : `
                            <div class="tqm-material-result-list">
                                ${
                                    Object.keys(plan.baseMaterials).length
                                        ? Object.entries(plan.baseMaterials)
                                            .sort((a, b) =>
                                                b[1] - a[1] ||
                                                a[0].localeCompare(b[0])
                                            )
                                            .map(([name, quantity]) => `
                                                <div class="tqm-material-result-item">
                                                    <span>${escapeHtml(name)}</span>
                                                    <strong>${Math.ceil(quantity).toLocaleString()}</strong>
                                                </div>
                                            `).join('')
                                        : `
                                            <div class="tqm-material-result-item">
                                                <span>${escapeHtml(plan.recipe.item)}</span>
                                                <strong>${plan.actions.toLocaleString()}</strong>
                                            </div>
                                        `
                                }
                            </div>
                        `}
                    </section>
                </div>
            ` : ''}

            <section class="tqm-card">
                <h2>XP / Hour Reference</h2>
                <div class="tqm-table-wrap">
                    <table class="tqm-table">
                        <thead>
                            <tr>
                                <th>Item</th>
                                <th>Profession</th>
                                <th>Level</th>
                                <th>XP / Action</th>
                                <th>Cycle</th>
                                <th>Actions / HR</th>
                                <th>XP / HR</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows.map((row, index) => {
                                const previous = rows[index - 1];
                                const showGroup =
                                    !previous ||
                                    previous.skill !== row.skill;
                                const showLevel =
                                    showGroup ||
                                    Number(previous.level || 0) !==
                                        Number(row.level || 0);

                                return `
                                    ${
                                        showGroup
                                            ? `
                                                <tr class="tqm-xp-profession-row">
                                                    <td colspan="7">
                                                        ${escapeHtml(
                                                            row.skill[0].toUpperCase() +
                                                            row.skill.slice(1)
                                                        )}
                                                    </td>
                                                </tr>
                                            `
                                            : ''
                                    }
                                    ${
                                        showLevel
                                            ? `
                                                <tr class="tqm-xp-level-row">
                                                    <td colspan="7">
                                                        Level ${row.level} actions
                                                    </td>
                                                </tr>
                                            `
                                            : ''
                                    }
                                    <tr class="${row.canMake ? '' : 'tqm-row-locked'}">
                                        <td><strong>${escapeHtml(row.item)}</strong></td>
                                        <td>${escapeHtml(
                                            row.skill[0].toUpperCase() +
                                            row.skill.slice(1)
                                        )}</td>
                                        <td>Lv. ${row.level}</td>
                                        <td>${formatXp(row.xp)}</td>
                                        <td>${formatSeconds(
                                            adjustedCraftTime(row.cycle, row.skill)
                                        )}</td>
                                        <td>${Math.floor(
                                            3600 /
                                            adjustedCraftTime(row.cycle, row.skill)
                                        ).toLocaleString()}</td>
                                        <td class="tqm-profit-positive">
                                            ${formatXpPerHour(
                                                row.xp * 3600 /
                                                adjustedCraftTime(
                                                    row.cycle,
                                                    row.skill
                                                )
                                            )}
                                        </td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>

                <p class="tqm-note">
                    XP requirements use Tidefall's level curve:
                    10 × level² + 30 × level − 80. Mastery changes output,
                    not XP earned per action.
                </p>
            </section>
        `;
    }

    function calculateGatheringRows() {
        const gatheringSkills = ['logging', 'mining', 'fishing'];

        return gatheringSkills.flatMap(skill => {
            return BUILT_IN_XP_RECIPES
                .filter(recipe => recipe.skill === skill)
                .map(recipe => {
                const cycle = adjustedCraftTime(
                    recipe.cycle,
                    skill
                );
                const yieldPerAction = yieldMultiplier(skill);
                const record = findItemPrice([recipe.item]);
                const exchangeSale = bestSaleValue(
                    record,
                    yieldPerAction
                );
                const vendorPrice = Number(
                    record?.vendorPrice ||
                    builtInVendorPrice(recipe.item) ||
                    0
                );
                const vendorValue = vendorPrice > 0
                    ? vendorPrice * yieldPerAction
                    : NaN;

                const inputCost = (recipe.ingredients || [])
                    .reduce((total, ingredient) => {
                        const inputRecord = findItemPrice([
                            ingredient.name
                        ]);
                        const input = exchangeBuyCost(
                            inputRecord,
                            Number(ingredient.quantity || 0)
                        );

                        return Number.isFinite(total) &&
                            Number.isFinite(input.value)
                                ? total + input.value
                                : NaN;
                    }, 0);

                const exchangeNet = Number.isFinite(
                    exchangeSale.value
                ) && Number.isFinite(inputCost)
                    ? exchangeSale.value - inputCost
                    : NaN;
                const vendorNet = Number.isFinite(vendorValue) &&
                    Number.isFinite(inputCost)
                    ? vendorValue - inputCost
                    : NaN;

                const exchangePerHour = Number.isFinite(exchangeNet)
                    ? goldPerHour(exchangeNet, cycle)
                    : NaN;
                const vendorPerHour = Number.isFinite(vendorNet)
                    ? goldPerHour(vendorNet, cycle)
                    : NaN;

                const candidates = [
                    {
                        method: 'Exchange',
                        value: exchangePerHour
                    },
                    {
                        method: 'Vendor',
                        value: vendorPerHour
                    }
                ].filter(candidate =>
                    Number.isFinite(candidate.value)
                );

                const best = candidates
                    .sort((a, b) => b.value - a.value)[0] || null;

                return {
                    skill,
                    item: recipe.item,
                    level: Number(recipe.level || 1),
                    xp: Number(recipe.xp || 0) +
                        experienceMasteryPoints(skill),
                    cycle,
                    yieldPerAction,
                    lowestSell: Number(record?.ask || 0),
                    vendorPrice,
                    exchangePerHour,
                    vendorPerHour,
                    bestPerHour: best?.value ?? NaN,
                    bestMethod: best?.method || 'N/A',
                    inputCost,
                    record
                };
            });
        });
    }

    function renderGathering() {
        preloadKnownVendorPrices();
        const rows = calculateGatheringRows();
        const groups = [
            ['logging', 'Logging'],
            ['mining', 'Mining'],
            ['fishing', 'Fishing']
        ];

        return `
            <section class="tqm-card">
                <div class="tqm-section-heading-row">
                    <div>
                        <h2>Gathering Profit</h2>
                        <p class="tqm-note">
                            Direct gathering income only. Yield mastery,
                            current-city action speed, Exchange tax, vendor
                            values, and Fishing bait cost are included.
                        </p>
                    </div>
                </div>

                <div class="tqm-gathering-card-grid">
                    ${groups.map(([skill, label]) => {
                        const skillRows = rows
                            .filter(row => row.skill === skill)
                            .sort((a, b) =>
                                Number(a.level || 0) -
                                    Number(b.level || 0) ||
                                String(a.item || '').localeCompare(
                                    String(b.item || '')
                                )
                            );

                        return `
                            <section class="tqm-gathering-group">
                            <h3>${label}</h3>

                            <div class="tqm-table-wrap">
                                <table class="tqm-table tqm-table-compact">
                                    <thead>
                                        <tr>
                                            <th>Resource</th>
                                            <th>Yield</th>
                                            <th>Time</th>
                                            <th>Profit</th>
                                            <th>Sell</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${skillRows.map(row => `
                                            <tr>
                                                <td>
                                                    <strong>
                                                        ${escapeHtml(row.item)}
                                                    </strong>
                                                    <small class="tqm-level-note">
                                                        Lv. ${row.level}
                                                    </small>
                                                </td>
                                                <td>
                                                    ${Number(
                                                        row.yieldPerAction
                                                    ).toLocaleString(
                                                        undefined,
                                                        {
                                                            maximumFractionDigits: 2
                                                        }
                                                    )}
                                                </td>
                                                <td>
                                                    ${formatSeconds(row.cycle)}
                                                </td>
                                                <td class="${
                                                    Number.isFinite(
                                                        row.bestPerHour
                                                    )
                                                        ? row.bestPerHour >= 0
                                                            ? 'tqm-profit-positive'
                                                            : 'tqm-profit-negative'
                                                        : ''
                                                }">
                                                    ${
                                                        Number.isFinite(
                                                            row.bestPerHour
                                                        )
                                                            ? moneyPerHour(
                                                                row.bestPerHour
                                                            )
                                                            : 'N/A'
                                                    }
                                                </td>
                                                <td class="tqm-best">
                                                    ${escapeHtml(
                                                        row.bestMethod
                                                    )}
                                                </td>
                                            </tr>
                                        `).join('')}
                                    </tbody>
                                </table>
                            </div>
                            </section>
                        `;
                    }).join('')}
                </div>
            </section>
        `;
    }

    function calculateBuyAndCraftOpportunities(
        woodRows = calculateWoodRows(),
        metalRows = calculateMetalRows()
    ) {
        const opportunities = [];
        const immediateSaleSources = new Set([
            'Exchange Buy Order',
            'Exchange Buy Order + Vendor',
            'Vendor'
        ]);

        const addOpportunity = ({
            item,
            type,
            route,
            inputLabel,
            inputCost,
            outputValue,
            saleSource,
            fee = 0,
            cycle,
            rawQuantity = 1,
            outputQuantity = 1,
            inputPurchase = null,
            outputSale = null,
            available = true
        }) => {
            const purchaseCost = Number(inputCost);
            const netOutputValue = Number(outputValue);
            const feeCost = Math.max(0, Number(fee) || 0);
            const seconds = Number(cycle);
            const rawCount = Math.max(0.0001, Number(rawQuantity) || 1);
            const outputCount = Math.max(
                0.0001,
                Number(outputQuantity) || 1
            );

            if (
                !available ||
                !(purchaseCost > 0) ||
                !Number.isFinite(netOutputValue) ||
                !(netOutputValue > 0) ||
                !(seconds > 0) ||
                !immediateSaleSources.has(String(saleSource || ''))
            ) {
                return;
            }

            const invested = purchaseCost + feeCost;
            const profit = netOutputValue - invested;
            const perHour = goldPerHour(profit, seconds);
            const roi = invested > 0
                ? profit / invested * 100
                : NaN;
            const capacities = [];

            if (
                inputPurchase?.depthKnown &&
                Number(inputPurchase.availableAtBestPrice || 0) > 0
            ) {
                capacities.push({
                    side: 'input',
                    batches: Math.floor(
                        Number(inputPurchase.availableAtBestPrice) /
                        rawCount
                    )
                });
            }

            if (
                String(saleSource || '').startsWith('Exchange Buy Order') &&
                outputSale?.depthKnown &&
                Number(outputSale.availableAtBestPrice || 0) > 0
            ) {
                capacities.push({
                    side: 'output',
                    batches: Math.floor(
                        Number(outputSale.availableAtBestPrice) /
                        outputCount
                    )
                });
            }

            const validCapacities = capacities.filter(
                capacity => capacity.batches >= 0
            );
            const limitingCapacity = validCapacities.length
                ? [...validCapacities].sort(
                    (a, b) => a.batches - b.batches
                )[0]
                : null;
            const quoteBatchCapacity = limitingCapacity
                ? limitingCapacity.batches
                : null;
            const rawAvailableAtQuote = Number.isFinite(quoteBatchCapacity)
                ? quoteBatchCapacity * rawCount
                : null;
            const outputAvailableAtQuote = Number.isFinite(quoteBatchCapacity)
                ? quoteBatchCapacity * outputCount
                : null;
            const totalProfitAtQuote = Number.isFinite(quoteBatchCapacity)
                ? quoteBatchCapacity * profit
                : null;

            opportunities.push({
                item,
                type,
                route,
                inputLabel,
                inputCost: purchaseCost,
                outputValue: netOutputValue,
                saleSource,
                fee: feeCost,
                invested,
                profit,
                perHour,
                roi,
                cycle: seconds,
                profitPerRaw: profit / rawCount,
                rawQuantity: rawCount,
                outputQuantity: outputCount,
                inputDepthKnown: Boolean(inputPurchase?.depthKnown),
                outputDepthKnown: Boolean(outputSale?.depthKnown),
                inputBestPrice: Number(
                    inputPurchase?.marketPrice ||
                    inputPurchase?.averagePrice ||
                    0
                ),
                outputBestPrice: Number(
                    outputSale?.bestPrice ||
                    outputSale?.marketPrice ||
                    0
                ),
                inputAvailableAtBestPrice: Number(
                    inputPurchase?.availableAtBestPrice || 0
                ),
                outputAvailableAtBestPrice: Number(
                    outputSale?.availableAtBestPrice || 0
                ),
                quoteBatchCapacity,
                rawAvailableAtQuote,
                outputAvailableAtQuote,
                totalProfitAtQuote,
                quoteLimitSide: limitingCapacity?.side || ''
            });
        };

        woodRows.forEach(row => {
            const logRecord = findItemPrice([
                `${row.material} Log`,
                `${row.material} Logs`
            ]);
            const logPurchase = exchangeBuyCost(logRecord, 1);

            addOpportunity({
                item: `${row.material} Planks`,
                type: 'Wood',
                route:
                    `Buy ${row.material} Logs → Make Planks → ` +
                    `${row.plankSale?.source || 'Unavailable'}`,
                inputLabel: `1 ${row.material} Log`,
                inputCost: logPurchase.value,
                outputValue: row.plankSale?.value,
                saleSource: row.plankSale?.source,
                cycle: row.plankChainTime,
                rawQuantity: 1,
                outputQuantity: yieldMultiplier('carpentry'),
                inputPurchase: logPurchase,
                outputSale: row.plankSale,
                available: row.canCraft
            });

            addOpportunity({
                item: `${row.material} Beams`,
                type: 'Wood',
                route:
                    `Buy ${row.material} Logs → Make Planks → Make Beams → ` +
                    `${row.beamSale?.source || 'Unavailable'}`,
                inputLabel: `1 ${row.material} Log`,
                inputCost: logPurchase.value,
                outputValue: row.beamSale?.value,
                saleSource: row.beamSale?.source,
                cycle: row.beamChainTime,
                rawQuantity: 1,
                outputQuantity:
                    yieldMultiplier('carpentry') *
                    yieldMultiplier('carpentry') / 2,
                inputPurchase: logPurchase,
                outputSale: row.beamSale,
                available: row.canCraft
            });
        });

        metalRows.forEach(row => {
            const oreRecord = findItemPrice([`${row.material} Ore`]);
            const barRecord = findItemPrice([
                `${row.material} Bar`,
                `${row.material} Bars`
            ]);
            const nailRecord = findItemPrice([
                `${row.material} Nail`,
                `${row.material} Nails`
            ]);
            const orePurchase = exchangeBuyCost(oreRecord, 2);
            const barsPerSmelt = yieldMultiplier('smelting');
            const nailsFromSmelt =
                barsPerSmelt * 4 * yieldMultiplier('crafting');
            const barSale = bestSaleValue(barRecord, barsPerSmelt);
            const nailSale = bestSaleValue(
                nailRecord,
                nailsFromSmelt
            );

            addOpportunity({
                item: `${row.material} Bars`,
                type: 'Metal',
                route:
                    `Buy ${row.material} Ore → Smelt Bars → ` +
                    `${barSale.source || 'Unavailable'}`,
                inputLabel: `2 ${row.material} Ore`,
                inputCost: orePurchase.value,
                outputValue: barSale.value,
                saleSource: barSale.source,
                fee: row.fee,
                cycle: row.barCycle,
                rawQuantity: 2,
                outputQuantity: barsPerSmelt,
                inputPurchase: orePurchase,
                outputSale: barSale,
                available: row.canSmelt
            });

            addOpportunity({
                item: `${row.material} Nails`,
                type: 'Metal',
                route:
                    `Buy ${row.material} Ore → Smelt Bars → Make Nails → ` +
                    `${nailSale.source || 'Unavailable'}`,
                inputLabel: `2 ${row.material} Ore`,
                inputCost: orePurchase.value,
                outputValue: nailSale.value,
                saleSource: nailSale.source,
                fee: row.fee,
                cycle:
                    row.barCycle + barsPerSmelt * row.nailCycle,
                rawQuantity: 2,
                outputQuantity: nailsFromSmelt,
                inputPurchase: orePurchase,
                outputSale: nailSale,
                available: row.canCraftNails
            });
        });

        calculateCookingRows().forEach(row => {
            const ingredientRecord = findItemPrice([
                row.ingredient,
                `${row.ingredient}s`
            ]);
            const cookedRecord = findItemPrice([row.item]);
            const ingredientPurchase = exchangeBuyCost(
                ingredientRecord,
                1
            );
            const cookedSale = bestSaleValue(
                cookedRecord,
                row.outputPerBatch
            );

            addOpportunity({
                item: row.item,
                type: 'Cooking',
                route:
                    `Buy ${row.ingredient} → Cook ${row.item} → ` +
                    `${cookedSale.source || 'Unavailable'}`,
                inputLabel: `1 ${row.ingredient}`,
                inputCost: ingredientPurchase.value,
                outputValue: cookedSale.value,
                saleSource: cookedSale.source,
                fee: row.fee,
                cycle: row.currentCycle,
                rawQuantity: 1,
                outputQuantity: row.outputPerBatch,
                inputPurchase: ingredientPurchase,
                outputSale: cookedSale,
                available: row.canCraft
            });
        });

        const metalByName = new Map(
            metalRows.map(row => [row.material, row])
        );

        calculateAmmunitionRows().forEach(row => {
            const metalRow = metalByName.get(row.metal);
            if (!metalRow) return;

            const oreRecord = findItemPrice([`${row.metal} Ore`]);
            const itemRecord = findItemPrice([row.itemName]);
            const orePurchase = exchangeBuyCost(oreRecord, 2);
            const barsPerSmelt = yieldMultiplier('smelting');
            const outputQuantity =
                barsPerSmelt * row.outputPerBatch;
            const itemSale = bestSaleValue(
                itemRecord,
                outputQuantity
            );
            const totalFee =
                Number(metalRow.fee || 0) +
                barsPerSmelt * Number(row.fee || 0);
            const totalCycle =
                metalRow.barCycle +
                barsPerSmelt * row.cycle;

            addOpportunity({
                item: row.itemName,
                type: 'Ammunition',
                route:
                    `Buy ${row.metal} Ore → Smelt Bars → ` +
                    `Make ${row.shotType} → ` +
                    `${itemSale.source || 'Unavailable'}`,
                inputLabel: `2 ${row.metal} Ore`,
                inputCost: orePurchase.value,
                outputValue: itemSale.value,
                saleSource: itemSale.source,
                fee: totalFee,
                cycle: totalCycle,
                rawQuantity: 2,
                outputQuantity,
                inputPurchase: orePurchase,
                outputSale: itemSale,
                available: metalRow.canSmelt && row.canCraft
            });
        });

        return opportunities.sort((a, b) =>
            b.perHour - a.perHour ||
            b.roi - a.roi ||
            b.profit - a.profit
        );
    }

    function renderNetWorthHistory() {
        const rangeId = NET_WORTH_RANGE_OPTIONS.some(
            option => option.id === state.preferences?.netWorthHistoryRange
        )
            ? state.preferences.netWorthHistoryRange
            : '7d';

        const {
            total: liveValue,
            invValue,
            gold,
            goldKnown,
            pricedCount,
            unpricedCount
        } = computeNetWorth();
        const fullHistory = Array.isArray(state.netWorthHistory)
            ? state.netWorthHistory
            : [];
        const rangePoints = netWorthHistoryPointsForRange(rangeId);
        const chartPoints = downsampleNetWorthPoints(rangePoints);
        const sparkline = buildNetWorthSparkline(chartPoints);

        const dayAgo = closestNetWorthPoint(
            fullHistory,
            Date.now() - 24 * 60 * 60 * 1000
        );
        const weekAgo = closestNetWorthPoint(
            fullHistory,
            Date.now() - 7 * 24 * 60 * 60 * 1000
        );

        const changeSince = reference => {
            if (!reference || !(Number(reference.v) > 0)) return null;

            const delta = liveValue - reference.v;
            return { delta, percent: (delta / reference.v) * 100 };
        };

        const change24h = changeSince(dayAgo);
        const change7d = changeSince(weekAgo);

        const changeState = change => {
            if (!change || change.delta === 0) return 'tqm-state-muted';
            return change.delta > 0
                ? 'tqm-state-positive'
                : 'tqm-state-negative';
        };

        const changeSubtext = change =>
            change
                ? `${change.percent >= 0 ? '+' : ''}${change.percent.toFixed(1)}%`
                : 'Not enough history yet';

        const knownCities = Object.keys(CITY_BONUSES).filter(
            city => city !== 'None'
        );
        const cityRows = knownCities
            .map(city => {
                const record = state.cityInventories?.[city];
                const known = Boolean(record?.updatedAt);
                const itemCount = Object.keys(record?.items || {}).length;

                return `
                    <div class="${known ? 'tqm-status-ok' : 'tqm-status-needed'}">
                        <span>${escapeHtml(city)}</span>
                        <strong>${known ? `${itemCount.toLocaleString()} items` : 'Not visited'}</strong>
                        <small>${formatSettingsTimestamp(record?.updatedAt)}</small>
                    </div>
                `;
            })
            .join('');

        return `
            <section class="tqm-card">
                <h2>Net Worth</h2>
                <p class="tqm-note">
                    Gold on hand plus the estimated sale value of everything
                    sitting in every city's Warehouse and in your Ship Hold,
                    priced the same way as the rest of Quartermaster
                    (Exchange orders first, vendor price as a floor).
                    Equipped gear isn't counted yet, and a city only counts
                    once you've opened its warehouse at least
                    once.${goldKnown ? '' : ' Gold couldn’t be read this session, so the total below is inventory-only — open the game so the header gold display is on screen.'}
                </p>

                <div class="tqm-dashboard-metrics">
                    <article class="tqm-metric-card tqm-state-positive">
                        <span>Net Worth</span>
                        <strong>${formatGold(liveValue, { allowZero: true })}</strong>
                        <small>
                            ${formatGold(gold, { allowZero: true })} gold ·
                            ${formatGold(invValue, { allowZero: true })} inventory
                        </small>
                    </article>

                    <article class="tqm-metric-card ${changeState(change24h)}">
                        <span>Last 24 Hours</span>
                        <strong>${change24h ? signedMoney(change24h.delta) : '—'}</strong>
                        <small>${changeSubtext(change24h)}</small>
                    </article>

                    <article class="tqm-metric-card ${changeState(change7d)}">
                        <span>Last 7 Days</span>
                        <strong>${change7d ? signedMoney(change7d.delta) : '—'}</strong>
                        <small>${changeSubtext(change7d)}</small>
                    </article>

                    <article class="tqm-metric-card tqm-state-muted">
                        <span>History</span>
                        <strong>${fullHistory.length.toLocaleString()} points</strong>
                        <small>
                            ${pricedCount.toLocaleString()} priced${
                                unpricedCount
                                    ? ` · ${unpricedCount.toLocaleString()} unpriced`
                                    : ''
                            }
                        </small>
                    </article>
                </div>

                <div class="tqm-networth-range">
                    <div class="tqm-networth-range-options">
                        ${NET_WORTH_RANGE_OPTIONS.map(option => `
                            <button
                                type="button"
                                class="${option.id === rangeId ? 'tqm-active' : ''}"
                                data-tqm-networth-range="${option.id}"
                            >${option.label}</button>
                        `).join('')}
                    </div>
                    <button
                        type="button"
                        class="tqm-action tqm-secondary"
                        id="tqm-clear-networth-history"
                    >Clear History</button>
                </div>

                ${sparkline ? `
                    <div class="tqm-networth-chart">
                        <svg viewBox="0 0 ${sparkline.width} ${sparkline.height}" preserveAspectRatio="none">
                            <path d="${sparkline.areaPath}" class="tqm-networth-area"></path>
                            <path d="${sparkline.linePath}" class="tqm-networth-line"></path>
                        </svg>
                        <div class="tqm-networth-chart-scale">
                            <span>${formatGold(sparkline.maxValue, { allowZero: true })}</span>
                            <span>${formatGold(sparkline.minValue, { allowZero: true })}</span>
                        </div>
                    </div>
                ` : `
                    <p class="tqm-note">
                        Not enough history yet for this range — Quartermaster
                        records a snapshot every 5 minutes while the game tab
                        is open, so check back after a little more playtime.
                    </p>
                `}
            </section>

            <section class="tqm-card">
                <h2>Warehouses Tracked</h2>
                <p class="tqm-note">
                    Each city has its own warehouse. Open a city's warehouse
                    with Quartermaster running to add it to Net Worth — cities
                    marked "Not visited" aren't counted yet.
                </p>
                <div class="tqm-settings-status-grid">
                    ${cityRows}
                </div>
            </section>
        `;
    }

    function renderOverview() {
        const woodRows = calculateWoodRows();
        const metalRows = calculateMetalRows();

        const wood = woodRows
            .map(row => {
                const candidates = [
                    {
                        choice: saleChoiceLabel('Sell Logs', row.logSale),
                        value: row.rawNet,
                        perHour: 0,
                        available: true
                    },
                    {
                        choice: saleChoiceLabel('Make Planks', row.plankSale),
                        value: row.plankNet,
                        perHour: row.plankGoldHour,
                        available:
                            !state.excludeLockedCrafts ||
                            row.canCraft
                    },
                    {
                        choice: saleChoiceLabel('Make Beams', row.beamSale),
                        value: row.beamNet,
                        perHour: row.beamGoldHour,
                        available:
                            !state.excludeLockedCrafts ||
                            row.canCraft
                    }
                ].filter(candidate =>
                    candidate.available &&
                    Number(candidate.value) > 0
                );

                const bestValue = [...candidates]
                    .sort((a, b) => b.value - a.value)[0] || null;
                const bestHourly = [...candidates]
                    .filter(candidate => candidate.perHour > 0)
                    .sort((a, b) => b.perHour - a.perHour)[0] || null;

                return {
                    item: row.material,
                    type: 'Wood',
                    bestValue,
                    bestHourly
                };
            })
            .filter(row => row.bestValue);

        const metal = metalRows
            .map(row => {
                const candidates = [
                    {
                        choice: saleChoiceLabel('Sell Ore', row.oreSale),
                        value: row.rawNet,
                        perHour: 0,
                        available:
                            !state.excludeLockedCrafts ||
                            row.canMine
                    },
                    {
                        choice: saleChoiceLabel('Smelt Bars', row.barSale),
                        value: row.barNet,
                        perHour: row.barGoldHour,
                        available:
                            !state.excludeLockedCrafts ||
                            (row.canMine && row.canSmelt)
                    },
                    {
                        choice: saleChoiceLabel('Make Nails', row.nailSale),
                        value: row.nailNet,
                        perHour: row.nailGoldHour,
                        available:
                            !state.excludeLockedCrafts ||
                            (row.canMine && row.canCraftNails)
                    }
                ].filter(candidate =>
                    candidate.available &&
                    Number(candidate.value) > 0
                );

                const bestValue = [...candidates]
                    .sort((a, b) => b.value - a.value)[0] || null;
                const bestHourly = [...candidates]
                    .filter(candidate => candidate.perHour > 0)
                    .sort((a, b) => b.perHour - a.perHour)[0] || null;

                return {
                    item: row.material,
                    type: 'Metal',
                    bestValue,
                    bestHourly
                };
            })
            .filter(row => row.bestValue);

        const opportunities = [
            ...wood.map(row => ({
                item: row.item,
                type: row.type,
                order: row.bestValue.choice,
                value: row.bestValue.value,
                perHour: row.bestHourly?.perHour || 0,
                hourlyOrder: row.bestHourly?.choice || row.bestValue.choice
            })),
            ...metal.map(row => ({
                item: row.item,
                type: row.type,
                order: row.bestValue.choice,
                value: row.bestValue.value,
                perHour: row.bestHourly?.perHour || 0,
                hourlyOrder: row.bestHourly?.choice || row.bestValue.choice
            }))
        ].sort((a, b) => b.value - a.value);

        const topValue = opportunities[0];
        const topHourly = [...opportunities]
            .filter(item => item.perHour > 0)
            .sort((a, b) => b.perHour - a.perHour)[0];
        const showBuyCraftRecommendations = Boolean(
            state.preferences?.showBuyCraftRecommendations
        );
        const buyCraftOpportunities = showBuyCraftRecommendations
            ? calculateBuyAndCraftOpportunities(woodRows, metalRows)
            : [];
        const profitableBuyCraft = buyCraftOpportunities.filter(
            item => item.profit > 0 && item.perHour > 0
        );
        const topBuyCraft = profitableBuyCraft[0] || null;
        const queue = calculatePlannerQueue();

        const capturedCount = Object.keys(state.prices).length;
        const masteryLoaded =
            Number(state.masteryUpdatedAt || 0) > 0 &&
            MASTERY_SKILLS.some(
                skill =>
                    experienceMasteryPoints(skill) > 0 ||
                    yieldMasteryPoints(skill) > 0
            );
        const exchangeLoaded = capturedCount > 0;
        const professionSkills = SUPPORTED_XP_SKILLS;
        const detectedLevelCount = professionSkills.filter(
            skill => Number(state.skillLevels[skill] || 0) > 0
        ).length;
        const levelsLoaded =
            detectedLevelCount === professionSkills.length;

        return `
            ${
                masteryLoaded && exchangeLoaded && levelsLoaded
                    ? ''
                    : `
                        <section class="tqm-setup-status tqm-setup-needed">
                            <div class="tqm-setup-status__header">
                                <span>Data Status</span>
                                <strong>Finish setup for accurate results</strong>
                            </div>

                            <div class="tqm-setup-status__items">
                                <div class="tqm-setup-item ${
                                    masteryLoaded
                                        ? 'tqm-setup-item--ready'
                                        : 'tqm-setup-item--needed'
                                }">
                                    <strong>
                                        ${masteryLoaded ? '✓ Mastery loaded' : '⚠ Mastery not detected'}
                                    </strong>
                                    <span>
                                        ${
                                            masteryLoaded
                                                ? 'Current mastery values are available.'
                                                : 'Open Command → Mastery and leave it open briefly so Quartermaster can read your mastery.'
                                        }
                                    </span>
                                </div>

                                <div class="tqm-setup-item ${
                                    exchangeLoaded
                                        ? 'tqm-setup-item--ready'
                                        : 'tqm-setup-item--needed'
                                }">
                                    <strong>
                                        ${
                                            exchangeLoaded
                                                ? `✓ ${capturedCount.toLocaleString()} Exchange prices captured`
                                                : '⚠ Exchange prices not loaded'
                                        }
                                    </strong>
                                    <span>
                                        ${
                                            exchangeLoaded
                                                ? 'Exchange data is available.'
                                                : 'Open the Exchange market table, choose a category, then click Read Exchange.'
                                        }
                                    </span>
                                </div>

                                <div class="tqm-setup-item ${
                                    levelsLoaded
                                        ? 'tqm-setup-item--ready'
                                        : 'tqm-setup-item--needed'
                                }">
                                    <strong>
                                        ${
                                            levelsLoaded
                                                ? '✓ Profession levels loaded'
                                                : `⚠ ${detectedLevelCount} / ${professionSkills.length} profession levels loaded`
                                        }
                                    </strong>
                                    <span>
                                        ${
                                            levelsLoaded
                                                ? 'All profession levels are available for recommendations.'
                                                : 'Open the Command tab where your profession levels are shown and leave it open briefly, or enter the missing levels in Settings.'
                                        }
                                    </span>
                                </div>
                            </div>
                        </section>
                    `
            }

            <section class="tqm-dashboard-hero">
                <div>
                    <div class="tqm-kicker">Quartermaster's Orders</div>
                    <h2>
                        ${showBuyCraftRecommendations && topBuyCraft
                            ? escapeHtml(topBuyCraft.route)
                            : topValue
                                ? `${escapeHtml(topValue.order)}: ${escapeHtml(topValue.item)}`
                                : 'Capture Exchange prices to begin'}
                    </h2>
                    <p>
                        ${showBuyCraftRecommendations && topBuyCraft
                            ? `Best buy-and-craft net profit: ${moneyPerHour(topBuyCraft.perHour)} · ${signedMoney(topBuyCraft.profit)} per batch · ${formatPercent(topBuyCraft.roi)} ROI`
                            : topValue
                                ? `Best sale value per gathered unit after all mastery yields: ${formatGold(topValue.value)}`
                                : 'Open an Exchange category and press Read Exchange.'}
                    </p>
                </div>
            </section>

            <div class="tqm-dashboard-metrics">
                <article class="tqm-metric-card tqm-state-positive">
                    <span>Highest Value</span>
                    <strong>${topValue ? escapeHtml(topValue.item) : '—'}</strong>
                    <small>
                        ${topValue
                            ? `${escapeHtml(topValue.order)} · ${formatGold(topValue.value)}`
                            : 'No usable prices'}
                    </small>
                </article>

                <article class="tqm-metric-card tqm-state-positive">
                    <span>Best Throughput</span>
                    <strong>${topHourly ? escapeHtml(topHourly.item) : '—'}</strong>
                    <small>
                        ${topHourly
                            ? `${escapeHtml(topHourly.hourlyOrder)} · ${moneyPerHour(topHourly.perHour)}`
                            : 'No usable rates'}
                    </small>
                </article>



                ${showBuyCraftRecommendations
                    ? `
                        <article class="tqm-metric-card ${topBuyCraft ? 'tqm-state-positive' : 'tqm-state-warning'}">
                            <span>Buy Mats & Craft</span>
                            <strong>${topBuyCraft ? escapeHtml(topBuyCraft.item) : '—'}</strong>
                            <small>
                                ${topBuyCraft
                                    ? `${moneyPerHour(topBuyCraft.perHour)} · ${formatPercent(topBuyCraft.roi)} ROI`
                                    : 'No profitable routes'}
                            </small>
                        </article>
                    `
                    : `
                        <article class="tqm-metric-card ${queue.rows.length ? 'tqm-state-warning' : 'tqm-state-muted'}">
                            <span>Crafting Queue</span>
                            <strong>${queue.rows.length.toLocaleString()} items</strong>
                            <small>${formatSeconds(queue.totalSeconds)}</small>
                        </article>
                    `}

                <article class="tqm-metric-card ${capturedCount ? 'tqm-state-positive' : 'tqm-state-warning'}">
                    <span>Market Data</span>
                    <strong>${capturedCount.toLocaleString()} prices</strong>
                    <small>Tax ${state.taxPercent}% · ${escapeHtml(state.currentCity)}</small>
                </article>
            </div>

            <div class="tqm-grid tqm-grid-2">
                <section class="tqm-card">
                    <h2>Top Value per Gathered Unit</h2>
                    ${renderOpportunityRows(opportunities.slice(0, 8), 'value')}
                </section>

                <section class="tqm-card">
                    <h2>Top Gross Crafting Throughput (g/hr)</h2>
                    ${renderOpportunityRows(
                        [...opportunities]
                            .filter(item => item.perHour > 0)
                            .map(item => ({
                                ...item,
                                order: item.hourlyOrder
                            }))
                            .sort((a, b) => b.perHour - a.perHour)
                            .slice(0, 8),
                        'perHour'
                    )}
                </section>
            </div>

            ${showBuyCraftRecommendations
                ? `
                    <section class="tqm-card">
                        <h2>Top Buy-and-Craft Profit (g/hr)</h2>
                        <p class="tqm-note">
                            Buys raw materials from active Exchange sell listings,
                            crafts with current mastery and city speed, then sells
                            through the best active buy order or vendor. Exchange tax,
                            crafting supply fees, and captured market depth are included.
                            Open an item detail and press Read Exchange to capture its
                            current order quantities.
                        </p>
                        ${renderBuyCraftRows(profitableBuyCraft.slice(0, 10))}
                    </section>
                `
                : ''}
        `;
    }

    function renderOpportunityRows(items, field) {
        if (!items.length) {
            return '<div class="tqm-empty">No usable prices captured yet.</div>';
        }

        return items.map((item, index) => `
            <div class="tqm-rank-row">
                <span class="tqm-rank">${index + 1}</span>
                <span class="tqm-rank-name">
                    <strong>${escapeHtml(item.item)}</strong>
                    <small>${escapeHtml(item.type)} · ${escapeHtml(item.order)}</small>
                </span>
                <span class="tqm-rank-value">
                    ${field === 'perHour' ? moneyPerHour(item[field]) : formatGold(item[field])}
                </span>
            </div>
        `).join('');
    }

    function renderBuyCraftRows(items) {
        if (!items.length) {
            return `
                <div class="tqm-empty">
                    No profitable buy-and-craft routes are available at the
                    currently captured prices.
                </div>
            `;
        }

        return items.map((item, index) => {
            const hasQuoteCapacity = Number.isFinite(
                item.quoteBatchCapacity
            );
            const rawUnitLabel = item.inputLabel.replace(
                /^\d+(?:\.\d+)?\s+/,
                ''
            );
            const displayedRawQuantity = Math.round(
                item.rawAvailableAtQuote || 0
            );
            const displayedRawLabel =
                displayedRawQuantity !== 1 && / Log$/i.test(rawUnitLabel)
                    ? `${rawUnitLabel}s`
                    : rawUnitLabel;
            const capacityLine = hasQuoteCapacity
                ? item.quoteLimitSide === 'output'
                    ? `${Number(item.quoteBatchCapacity).toLocaleString()} batches at current buy-order depth · ${signedMoney(item.totalProfitAtQuote)} before the next bid level`
                    : `${displayedRawQuantity.toLocaleString()} ${displayedRawLabel} available at ${formatGold(item.inputBestPrice, { allowZero: true })} · ${signedMoney(item.totalProfitAtQuote)} before the next ask level`
                : 'Open the raw-material detail and press Read Exchange to capture quantity';
            const tooltip = [
                `Buy: ${item.inputLabel} for ${formatGold(item.inputCost, { allowZero: true })}`,
                item.fee > 0
                    ? `Crafting fee: ${formatGold(item.fee, { allowZero: true })}`
                    : '',
                `Sell: ${formatGold(item.outputValue, { allowZero: true })} through ${item.saleSource}`,
                `Crafting time: ${formatCycleSeconds(item.cycle)}`
            ].filter(Boolean).join('\n');

            return `
                <div class="tqm-rank-row tqm-buy-craft-row" title="${escapeHtml(tooltip)}">
                    <span class="tqm-rank">${index + 1}</span>
                    <span class="tqm-rank-name">
                        <strong>${escapeHtml(item.item)}</strong>
                        <small>
                            ${escapeHtml(item.type)} ·
                            ${escapeHtml(item.route)}
                        </small>
                    </span>
                    <span class="tqm-rank-value tqm-buy-craft-value">
                        <strong>${signedMoneyPerHour(item.perHour)}</strong>
                        <small>
                            ${signedMoney(item.profit)} / batch ·
                            ${formatPercent(item.roi)} ROI
                        </small>
                        <small>${escapeHtml(capacityLine)}</small>
                    </span>
                </div>
            `;
        }).join('');
    }

    function craftProfitTooltip({
        inputLabel,
        inputCost,
        inputSource = '',
        outputLabel,
        outputQuantity,
        outputValue,
        saleSource,
        fee = 0,
        feeLabel = 'Crafting fee',
        profit,
        cycle
    }) {
        const lines = [
            `Input: ${inputLabel} (${formatGold(inputCost, { allowZero: true })})`
        ];

        if (inputSource) {
            lines.push(`Input source: ${inputSource}`);
        }

        lines.push(
            `Expected output: ${Number(outputQuantity || 0).toFixed(2).replace(/\.00$/, '')} ${outputLabel}`,
            `Net output value: ${formatGold(outputValue, { allowZero: true })}`,
            `Sell through: ${saleSource || 'N/A'}`
        );

        if (/^Exchange/i.test(String(saleSource || ''))) {
            lines.push(`Exchange tax: ${state.taxPercent}%`);
        }

        if (Number(fee || 0) > 0) {
            lines.push(`${feeLabel}: ${formatGold(fee, { allowZero: true })}`);
        }

        lines.push(
            `Profit: ${signedMoney(profit)}`,
            `Cycle: ${formatCycleSeconds(cycle)}`
        );

        return lines.join('\n');
    }

    function renderWood() {
        const rows = calculateWoodRows();

        return `
            <div class="tqm-processing-layout">
            <section class="tqm-card">
                <div class="tqm-section-heading-row">
                    <div>
                        <h2>Wood Crafting Profit</h2>
                        <p class="tqm-note">
                            Profit compares the finished output with the input's
                            immediate sale value: the best Exchange buy order after
                            tax, or vendor value when no buy order is available.
                        </p>
                    </div>
                </div>

                <div class="tqm-table-wrap">
                    <table class="tqm-table tqm-table-compact">
                        <thead>
                            <tr>
                                <th>Product</th>
                                <th>Action</th>
                                <th>Profit</th>
                                <th>Profit/hr</th>
                                <th>Sell</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows.flatMap(row => [
                                `
                                    <tr class="${row.locked ? 'tqm-row-locked' : ''}">
                                        <td>
                                            <strong>
                                                ${escapeHtml(`${row.material} Planks`)}
                                            </strong>
                                            <small class="tqm-level-note">
                                                Lv. ${row.requiredLevel}${row.locked ? ' · Locked' : ''}
                                            </small>
                                        </td>
                                        <td>Log → Planks</td>
                                        <td title="${escapeHtml(craftProfitTooltip({
                                            inputLabel: `1 ${row.material} Log`,
                                            inputCost: row.plankInputCost,
                                            outputLabel: `${row.material} Planks`,
                                            outputQuantity: yieldMultiplier('carpentry'),
                                            outputValue: row.plankOutputValue,
                                            saleSource: row.plankActionSale?.source,
                                            profit: row.plankActionProfit,
                                            cycle: row.plankCycle
                                        }))}" class="${
                                            Number.isFinite(
                                                row.plankActionProfit
                                            )
                                                ? row.plankActionProfit >= 0
                                                    ? 'tqm-profit-positive'
                                                    : 'tqm-profit-negative'
                                                : ''
                                        }">
                                            ${
                                                Number.isFinite(
                                                    row.plankActionProfit
                                                )
                                                    ? signedMoney(
                                                        row.plankActionProfit
                                                    )
                                                    : 'N/A'
                                            }
                                        </td>
                                        <td class="${
                                            Number.isFinite(
                                                row.plankActionProfitHour
                                            )
                                                ? row.plankActionProfitHour >= 0
                                                    ? 'tqm-profit-positive'
                                                    : 'tqm-profit-negative'
                                                : ''
                                        }">
                                            ${
                                                Number.isFinite(
                                                    row.plankActionProfitHour
                                                )
                                                    ? signedMoneyPerHour(
                                                        row.plankActionProfitHour
                                                    )
                                                    : 'N/A'
                                            }
                                        </td>
                                        <td class="tqm-best">
                                            ${renderPriceSource(
                                                row.plankActionSale?.source ||
                                                'N/A',
                                                [
                                                    row.plankRecord,
                                                    row.logRecord
                                                ],
                                                {
                                                    skill: 'carpentry',
                                                    includeInventory: true
                                                }
                                            )}
                                        </td>
                                    </tr>
                                `,
                                `
                                    <tr class="${row.locked ? 'tqm-row-locked' : ''}">
                                        <td>
                                            <strong>
                                                ${escapeHtml(`${row.material} Beams`)}
                                            </strong>
                                            <small class="tqm-level-note">
                                                Lv. ${row.requiredLevel}${row.locked ? ' · Locked' : ''}
                                            </small>
                                        </td>
                                        <td>2 Planks → Beams</td>
                                        <td title="${escapeHtml(craftProfitTooltip({
                                            inputLabel: `2 ${row.material} Planks`,
                                            inputCost: row.beamInputCost,
                                            outputLabel: `${row.material} Beams`,
                                            outputQuantity: yieldMultiplier('carpentry'),
                                            outputValue: row.beamOutputValue,
                                            saleSource: row.beamActionSale?.source,
                                            profit: row.beamActionProfit,
                                            cycle: row.beamCycle
                                        }))}" class="${
                                            Number.isFinite(
                                                row.beamActionProfit
                                            )
                                                ? row.beamActionProfit >= 0
                                                    ? 'tqm-profit-positive'
                                                    : 'tqm-profit-negative'
                                                : ''
                                        }">
                                            ${
                                                Number.isFinite(
                                                    row.beamActionProfit
                                                )
                                                    ? signedMoney(
                                                        row.beamActionProfit
                                                    )
                                                    : 'N/A'
                                            }
                                        </td>
                                        <td class="${
                                            Number.isFinite(
                                                row.beamActionProfitHour
                                            )
                                                ? row.beamActionProfitHour >= 0
                                                    ? 'tqm-profit-positive'
                                                    : 'tqm-profit-negative'
                                                : ''
                                        }">
                                            ${
                                                Number.isFinite(
                                                    row.beamActionProfitHour
                                                )
                                                    ? signedMoneyPerHour(
                                                        row.beamActionProfitHour
                                                    )
                                                    : 'N/A'
                                            }
                                        </td>
                                        <td class="tqm-best">
                                            ${renderPriceSource(
                                                row.beamActionSale?.source ||
                                                'N/A',
                                                [
                                                    row.beamRecord,
                                                    row.plankRecord
                                                ],
                                                {
                                                    skill: 'carpentry',
                                                    includeInventory: true
                                                }
                                            )}
                                        </td>
                                    </tr>
                                `
                            ]).join('')}
                        </tbody>
                    </table>
                </div>
            </section>

            <section class="tqm-card">
                <div class="tqm-section-heading-row">
                    <div>
                        <h2>Wood Crafting Times</h2>
                        <p class="tqm-note">
                            Current-city Carpentry speed bonuses are included.
                        </p>
                    </div>

                    <div class="tqm-best-port-badge">
                        <span>Best Carpentry Port</span>
                        <strong>
                            ${escapeHtml(bestCityForSkill('carpentry'))}
                        </strong>
                    </div>
                </div>

                <div class="tqm-table-wrap">
                    <table class="tqm-table tqm-table-compact">
                        <thead>
                            <tr>
                                <th>Resource</th>
                                <th>Planks</th>
                                <th>Beams</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows.map(row => `
                                <tr class="${row.locked ? 'tqm-row-locked' : ''}">
                                    <td>
                                        <strong>
                                            ${escapeHtml(row.material)}
                                        </strong>
                                    </td>
                                    <td>
                                        ${formatCycleSeconds(
                                            adjustedCraftTime(
                                                WOOD_CRAFT_TIMES[
                                                    row.material
                                                ]?.plank,
                                                'carpentry'
                                            )
                                        )}
                                    </td>
                                    <td>
                                        ${formatCycleSeconds(
                                            adjustedCraftTime(
                                                WOOD_CRAFT_TIMES[
                                                    row.material
                                                ]?.beam,
                                                'carpentry'
                                            )
                                        )}
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </section>
            </div>
        `;
    }

    function renderMetal() {
        const rows = calculateMetalRows();

        return `
            <div class="tqm-processing-layout">
            <section class="tqm-card">
                <div class="tqm-section-heading-row">
                    <div>
                        <h2>Metal Crafting Profit</h2>
                        <p class="tqm-note">
                            Profit compares the finished output with the input
                            value and crafting fee. Missing asks fall back to the
                            input's immediate sale value.
                        </p>
                    </div>
                </div>

                <div class="tqm-table-wrap">
                    <table class="tqm-table tqm-table-compact">
                        <thead>
                            <tr>
                                <th>Product</th>
                                <th>Action</th>
                                <th>Profit</th>
                                <th>Profit/hr</th>
                                <th>Sell</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows.flatMap(row => [
                                `
                                    <tr>
                                        <td>
                                            <strong>
                                                ${escapeHtml(`${row.material} Bars`)}
                                            </strong>
                                            <small class="tqm-level-note">
                                                Lv. ${row.barRequiredLevel}
                                            </small>
                                        </td>
                                        <td>
                                            2 Ore → ${Number(
                                                yieldMultiplier('smelting')
                                            ).toLocaleString(undefined, {
                                                maximumFractionDigits: 2
                                            })} ${
                                                yieldMultiplier('smelting') === 1
                                                    ? 'Bar'
                                                    : 'Bars'
                                            }
                                        </td>
                                        <td title="${escapeHtml(craftProfitTooltip({
                                            inputLabel: `2 ${row.material} Ore`,
                                            inputCost: row.barActionInputCost,
                                            inputSource: row.barActionInput?.source,
                                            outputLabel: yieldMultiplier('smelting') === 1
                                                ? `${row.material} Bar`
                                                : `${row.material} Bars`,
                                            outputQuantity: yieldMultiplier('smelting'),
                                            outputValue: row.barActionOutputValue,
                                            saleSource: row.barActionSale?.source,
                                            fee: row.fee,
                                            feeLabel: 'Smelting supply fee',
                                            profit: row.barActionProfit,
                                            cycle: row.barCycle
                                        }))}" class="${
                                            Number.isFinite(
                                                row.barActionProfit
                                            )
                                                ? row.barActionProfit >= 0
                                                    ? 'tqm-profit-positive'
                                                    : 'tqm-profit-negative'
                                                : ''
                                        }">
                                            ${
                                                Number.isFinite(
                                                    row.barActionProfit
                                                )
                                                    ? signedMoney(
                                                        row.barActionProfit
                                                    )
                                                    : 'N/A'
                                            }
                                        </td>
                                        <td class="${
                                            Number.isFinite(
                                                row.barActionProfitHour
                                            )
                                                ? row.barActionProfitHour >= 0
                                                    ? 'tqm-profit-positive'
                                                    : 'tqm-profit-negative'
                                                : ''
                                        }">
                                            ${
                                                Number.isFinite(
                                                    row.barActionProfitHour
                                                )
                                                    ? signedMoneyPerHour(
                                                        row.barActionProfitHour
                                                    )
                                                    : 'N/A'
                                            }
                                        </td>
                                        <td class="tqm-best">
                                            ${escapeHtml(
                                                row.barActionSale?.source ||
                                                'N/A'
                                            )}
                                        </td>
                                    </tr>
                                `,
                                `
                                    <tr>
                                        <td>
                                            <strong>
                                                ${escapeHtml(`${row.material} Nails`)}
                                            </strong>
                                            <small class="tqm-level-note">
                                                Lv. ${row.nailRequiredLevel}
                                            </small>
                                        </td>
                                        <td>
                                            1 Bar → ${Number(
                                                row.nailsPerAction
                                            ).toLocaleString(undefined, {
                                                maximumFractionDigits: 2
                                            })} Nails
                                        </td>
                                        <td title="${escapeHtml(craftProfitTooltip({
                                            inputLabel: `1 ${row.material} Bar`,
                                            inputCost: row.nailActionInputCost,
                                            inputSource: row.nailActionInput?.source,
                                            outputLabel: `${row.material} Nails`,
                                            outputQuantity: row.nailsPerAction,
                                            outputValue: row.nailActionOutputValue,
                                            saleSource: row.nailActionSale?.source,
                                            profit: row.nailActionProfit,
                                            cycle: row.nailCycle
                                        }))}" class="${
                                            Number.isFinite(
                                                row.nailActionProfit
                                            )
                                                ? row.nailActionProfit >= 0
                                                    ? 'tqm-profit-positive'
                                                    : 'tqm-profit-negative'
                                                : ''
                                        }">
                                            ${
                                                Number.isFinite(
                                                    row.nailActionProfit
                                                )
                                                    ? signedMoney(
                                                        row.nailActionProfit
                                                    )
                                                    : 'N/A'
                                            }
                                        </td>
                                        <td class="${
                                            Number.isFinite(
                                                row.nailActionProfitHour
                                            )
                                                ? row.nailActionProfitHour >= 0
                                                    ? 'tqm-profit-positive'
                                                    : 'tqm-profit-negative'
                                                : ''
                                        }">
                                            ${
                                                Number.isFinite(
                                                    row.nailActionProfitHour
                                                )
                                                    ? signedMoneyPerHour(
                                                        row.nailActionProfitHour
                                                    )
                                                    : 'N/A'
                                            }
                                        </td>
                                        <td class="tqm-best">
                                            ${escapeHtml(
                                                row.nailActionSale?.source ||
                                                'N/A'
                                            )}
                                        </td>
                                    </tr>
                                `
                            ]).join('')}
                        </tbody>
                    </table>
                </div>
            </section>

            <section class="tqm-card">
                <div class="tqm-section-heading-row">
                    <div>
                        <h2>Metal Crafting Times</h2>
                        <p class="tqm-note">
                            Current-city Smelting and Crafting speed bonuses
                            are included.
                        </p>
                    </div>

                    <div class="tqm-port-badge-group">
                        <div class="tqm-best-port-badge">
                            <span>Best Smelting Port</span>
                            <strong>
                                ${escapeHtml(bestCityForSkill('smelting'))}
                            </strong>
                        </div>

                        <div class="tqm-best-port-badge">
                            <span>Best Crafting Port</span>
                            <strong>
                                ${escapeHtml(bestCityForSkill('crafting'))}
                            </strong>
                        </div>
                    </div>
                </div>

                <div class="tqm-table-wrap">
                    <table class="tqm-table tqm-table-compact">
                        <thead>
                            <tr>
                                <th>Resource</th>
                                <th>Bars</th>
                                <th>Nails</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows.map(row => `
                                <tr>
                                    <td>
                                        <strong>
                                            ${escapeHtml(row.material)}
                                        </strong>
                                    </td>
                                    <td>
                                        ${formatCycleSeconds(
                                            adjustedCraftTime(
                                                METAL_CRAFT_TIMES[
                                                    row.material
                                                ]?.bar,
                                                'smelting'
                                            )
                                        )}
                                    </td>
                                    <td>
                                        ${formatCycleSeconds(
                                            adjustedCraftTime(
                                                METAL_CRAFT_TIMES[
                                                    row.material
                                                ]?.nail,
                                                'crafting'
                                            )
                                        )}
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </section>
            </div>
        `;
    }

    // =========================================================
    // SKILL-BASED ECONOMY TABS
    // =========================================================

    function renderGatheringSubset(skills, title, note) {
        preloadKnownVendorPrices();

        const allowed = new Set(skills);
        const rows = calculateGatheringRows();
        const labels = {
            logging: 'Logging',
            mining: 'Mining',
            fishing: 'Fishing'
        };

        const groups = skills.map(skill => [skill, labels[skill] || skill]);

        return `
            <section class="tqm-card">
                <div class="tqm-section-heading-row">
                    <div>
                        <h2>${escapeHtml(title)}</h2>
                        <p class="tqm-note">${escapeHtml(note)}</p>
                    </div>
                </div>

                <div class="tqm-gathering-card-grid tqm-gathering-${skills.length}">
                    ${groups.map(([skill, label]) => {
                        const currentLevel = Number(state.skillLevels[skill] || 0);
                        const levelKnown = Number.isFinite(currentLevel) && currentLevel > 0;
                        const skillRows = rows
                            .filter(row => allowed.has(row.skill) && row.skill === skill)
                            .sort((a, b) =>
                                Number(a.level || 0) - Number(b.level || 0) ||
                                String(a.item || '').localeCompare(String(b.item || ''))
                            );

                        return `
                            <section class="tqm-gathering-group">
                                <h3>${escapeHtml(label)}</h3>

                                <div class="tqm-table-wrap">
                                    <table class="tqm-table tqm-table-compact">
                                        <thead>
                                            <tr>
                                                <th>Resource</th>
                                                <th>Yield</th>
                                                <th>Time</th>
                                                <th>Profit/hr</th>
                                                <th>Sell</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            ${skillRows.map(row => {
                                                const locked =
                                                    levelKnown &&
                                                    Number(row.level || 1) > currentLevel;

                                                return `
                                                <tr class="${locked ? 'tqm-row-locked' : ''}">
                                                    <td>
                                                        <strong>${escapeHtml(row.item)}</strong>
                                                        <small class="tqm-level-note">
                                                            Lv. ${row.level}${locked ? ' · Locked' : ''}
                                                        </small>
                                                    </td>
                                                    <td>
                                                        ${Number(row.yieldPerAction).toLocaleString(undefined, {
                                                            maximumFractionDigits: 2
                                                        })}
                                                    </td>
                                                    <td>${formatSeconds(row.cycle)}</td>
                                                    <td class="${
                                                        Number.isFinite(row.bestPerHour)
                                                            ? row.bestPerHour >= 0
                                                                ? 'tqm-profit-positive'
                                                                : 'tqm-profit-negative'
                                                            : ''
                                                    }">
                                                        ${Number.isFinite(row.bestPerHour)
                                                            ? moneyPerHour(row.bestPerHour)
                                                            : 'N/A'}
                                                    </td>
                                                    <td class="tqm-best">
                                                        ${renderPriceSource(
                                                            row.bestMethod,
                                                            row.record,
                                                            {
                                                                skill: row.skill,
                                                                includeInventory: false
                                                            }
                                                        )}
                                                    </td>
                                                </tr>
                                            `;
                                            }).join('')}
                                        </tbody>
                                    </table>
                                </div>
                            </section>
                        `;
                    }).join('')}
                </div>
            </section>
        `;
    }

    function renderLoggingMining() {
        return renderGatheringSubset(
            ['logging', 'mining'],
            'Logging / Mining Profit',
            'Direct gathering income. Yield mastery, current-city action speed, Exchange tax, and vendor values are included.'
        );
    }

    function renderFishingSkill() {
        return renderGatheringSubset(
            ['fishing'],
            'Fishing Profit',
            'Direct fishing income. Yield mastery, action speed, bait cost, Exchange tax, and vendor values are included.'
        );
    }

    function renderCarpentrySkill() {
        return renderWood()
            .replace('Wood Crafting Profit', 'Carpentry Profit')
            .replace('Wood Crafting Times', 'Carpentry Times');
    }

    function renderSmeltingSkill() {
        const rows = calculateMetalRows();
        const smeltingYield = yieldMultiplier('smelting');

        return `
            <div class="tqm-processing-layout">
                <section class="tqm-card">
                    <div class="tqm-section-heading-row">
                        <div>
                            <h2>Smelting Profit</h2>
                            <p class="tqm-note">
                                Ore → Bars only. Profit uses the same Smelting calculation that was previously shown in the Metal tab.
                            </p>
                        </div>
                    </div>

                    <div class="tqm-table-wrap">
                        <table class="tqm-table tqm-table-compact">
                            <thead>
                                <tr>
                                    <th>Product</th>
                                    <th>Action</th>
                                    <th>Profit</th>
                                    <th>Profit/hr</th>
                                    <th>Sell</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${rows.map(row => `
                                    <tr class="${row.barLocked ? 'tqm-row-locked' : ''}">
                                        <td>
                                            <strong>${escapeHtml(`${row.material} Bars`)}</strong>
                                            <small class="tqm-level-note">Lv. ${row.barRequiredLevel}${row.barLocked ? ' · Locked' : ''}</small>
                                        </td>
                                        <td>
                                            2 Ore → ${Number(smeltingYield).toLocaleString(undefined, {
                                                maximumFractionDigits: 2
                                            })} ${smeltingYield === 1 ? 'Bar' : 'Bars'}
                                        </td>
                                        <td title="${escapeHtml(craftProfitTooltip({
                                            inputLabel: `2 ${row.material} Ore`,
                                            inputCost: row.barActionInputCost,
                                            inputSource: row.barActionInput?.source,
                                            outputLabel: smeltingYield === 1
                                                ? `${row.material} Bar`
                                                : `${row.material} Bars`,
                                            outputQuantity: smeltingYield,
                                            outputValue: row.barActionOutputValue,
                                            saleSource: row.barActionSale?.source,
                                            fee: row.fee,
                                            feeLabel: 'Smelting supply fee',
                                            profit: row.barActionProfit,
                                            cycle: row.barCycle
                                        }))}" class="${
                                            Number.isFinite(row.barActionProfit)
                                                ? row.barActionProfit >= 0
                                                    ? 'tqm-profit-positive'
                                                    : 'tqm-profit-negative'
                                                : ''
                                        }">
                                            ${Number.isFinite(row.barActionProfit)
                                                ? signedMoney(row.barActionProfit)
                                                : 'N/A'}
                                        </td>
                                        <td class="${
                                            Number.isFinite(row.barActionProfitHour)
                                                ? row.barActionProfitHour >= 0
                                                    ? 'tqm-profit-positive'
                                                    : 'tqm-profit-negative'
                                                : ''
                                        }">
                                            ${Number.isFinite(row.barActionProfitHour)
                                                ? signedMoneyPerHour(row.barActionProfitHour)
                                                : 'N/A'}
                                        </td>
                                        <td class="tqm-best">
                                            ${renderPriceSource(
                                                row.barActionSale?.source || 'N/A',
                                                [
                                                    row.barRecord,
                                                    row.oreRecord
                                                ],
                                                {
                                                    skill: 'smelting',
                                                    includeInventory: true
                                                }
                                            )}
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </section>

                <section class="tqm-card">
                    <div class="tqm-section-heading-row">
                        <div>
                            <h2>Smelting Times</h2>
                            <p class="tqm-note">Current-city Smelting speed bonuses are included.</p>
                        </div>
                        <div class="tqm-best-port-badge">
                            <span>Best Smelting Port</span>
                            <strong>${escapeHtml(bestCityForSkill('smelting'))}</strong>
                        </div>
                    </div>

                    <div class="tqm-table-wrap">
                        <table class="tqm-table tqm-table-compact">
                            <thead>
                                <tr><th>Resource</th><th>Time</th></tr>
                            </thead>
                            <tbody>
                                ${rows.map(row => `
                                    <tr class="${row.barLocked ? 'tqm-row-locked' : ''}">
                                        <td><strong>${escapeHtml(`${row.material} Bars`)}</strong></td>
                                        <td>${formatCycleSeconds(row.barCycle)}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </section>
            </div>
        `;
    }
    function calculateGenericRecipeProfitRows(recipes) {
        return recipes.map(recipe => {
            const shared = calculateSharedCraftProfit(
                recipe,
                {
                    inputMode:
                        recipe.inputMode ||
                        (recipe.skill === 'carpentry'
                            ? 'opportunity'
                            : 'purchase')
                }
            );

            return {
                ...recipe,
                ingredientDetails: shared.ingredients,
                inputCost: shared.inputCost,
                outputQuantity: shared.outputPerBatch,
                outputRecord: shared.outputRecord,
                outputSale: shared.outputSale,
                outputValue: shared.outputValue,
                fee: shared.fee,
                cycle: shared.cycle,
                profit: shared.profitPerAction,
                profitHour: shared.profitPerHour,
                canCraft: hasRequiredLevel(
                    recipe.skill,
                    recipe.requiredLevel
                ),
                locked: shared.locked,
                shared
            };
        });
    }

    function recipeActionLabel(row) {
        const input = (row.ingredients || [])
            .map(ingredient => `${Number(ingredient.quantity || 0).toLocaleString()} ${ingredient.name}`)
            .join(' + ');
        const output = `${Number(row.outputQuantity || 1).toLocaleString(undefined, {
            maximumFractionDigits: 2
        })} ${row.name}`;

        return `${input || 'Materials'} → ${output}`;
    }

    function genericProfitTable(rows, { emptyLabel = 'No recipes available.' } = {}) {
        return `
            <div class="tqm-table-wrap">
                <table class="tqm-table tqm-table-compact">
                    <thead>
                        <tr>
                            <th>Product</th>
                            <th>Action</th>
                            <th>Profit</th>
                            <th>Profit/hr</th>
                            <th>Sell</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows.length
                            ? rows.map(row => `
                                <tr class="${row.locked ? 'tqm-row-locked' : ''}">
                                    <td>
                                        <strong>${escapeHtml(row.name)}</strong>
                                        <small class="tqm-level-note">Lv. ${row.requiredLevel}${row.locked ? ' · Locked' : ''}</small>
                                    </td>
                                    <td>${escapeHtml(recipeActionLabel(row))}</td>
                                    <td class="${
                                        Number.isFinite(row.profit)
                                            ? row.profit >= 0
                                                ? 'tqm-profit-positive'
                                                : 'tqm-profit-negative'
                                            : ''
                                    }">
                                        ${Number.isFinite(row.profit)
                                            ? signedMoney(row.profit)
                                            : 'N/A'}
                                    </td>
                                    <td class="${
                                        Number.isFinite(row.profitHour)
                                            ? row.profitHour >= 0
                                                ? 'tqm-profit-positive'
                                                : 'tqm-profit-negative'
                                            : ''
                                    }">
                                        ${Number.isFinite(row.profitHour)
                                            ? signedMoneyPerHour(row.profitHour)
                                            : 'N/A'}
                                    </td>
                                    <td class="tqm-best">
                                        ${renderPriceSource(
                                            row.outputSale?.source || 'N/A',
                                            row.shared?.freshness ||
                                            row.outputRecord,
                                            {
                                                skill: row.skill || '',
                                                includeInventory: true
                                            }
                                        )}
                                    </td>
                                </tr>
                            `).join('')
                            : `<tr><td colspan="5" class="tqm-empty">${escapeHtml(emptyLabel)}</td></tr>`}
                    </tbody>
                </table>
            </div>
        `;
    }

    function renderCraftingSkill() {
        const metalRows = calculateMetalRows();
        const nailRows = metalRows.map(row => ({
            name: `${row.material} Nails`,
            material: row.material,
            requiredLevel: row.nailRequiredLevel,
            canCraft: row.canCraftNails,
            locked: row.nailLocked,
            outputQuantity: row.nailsPerAction,
            profit: row.nailActionProfit,
            profitHour: row.nailActionProfitHour,
            inputRecord: row.barRecord,
            outputRecord: row.nailRecord,
            outputSale: row.nailActionSale,
            cycle: row.nailCycle
        }));

        const repairRecipes = plannerRecipeCatalog().filter(recipe =>
            recipe.skill === 'crafting' &&
            String(recipe.id || '').startsWith('crafting:repair:')
        );
        const repairRows = calculateGenericRecipeProfitRows(repairRecipes);

        return `
            <div class="tqm-processing-layout">
                <section class="tqm-card">
                    <div class="tqm-section-heading-row">
                        <div>
                            <h2>Crafting — Nails</h2>
                            <p class="tqm-note">
                                Nails have moved out of the old Metal tab because they use the Crafting skill.
                            </p>
                        </div>
                    </div>

                    <div class="tqm-table-wrap">
                        <table class="tqm-table tqm-table-compact">
                            <thead>
                                <tr>
                                    <th>Product</th>
                                    <th>Action</th>
                                    <th>Profit</th>
                                    <th>Profit/hr</th>
                                    <th>Sell</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${nailRows.map(row => `
                                    <tr class="${row.locked ? 'tqm-row-locked' : ''}">
                                        <td>
                                            <strong>${escapeHtml(row.name)}</strong>
                                            <small class="tqm-level-note">Lv. ${row.requiredLevel}${row.locked ? ' · Locked' : ''}</small>
                                        </td>
                                        <td>
                                            1 ${escapeHtml(row.material)} Bar → ${Number(row.outputQuantity).toLocaleString(undefined, {
                                                maximumFractionDigits: 2
                                            })} Nails
                                        </td>
                                        <td class="${
                                            Number.isFinite(row.profit)
                                                ? row.profit >= 0
                                                    ? 'tqm-profit-positive'
                                                    : 'tqm-profit-negative'
                                                : ''
                                        }">
                                            ${Number.isFinite(row.profit)
                                                ? signedMoney(row.profit)
                                                : 'N/A'}
                                        </td>
                                        <td class="${
                                            Number.isFinite(row.profitHour)
                                                ? row.profitHour >= 0
                                                    ? 'tqm-profit-positive'
                                                    : 'tqm-profit-negative'
                                                : ''
                                        }">
                                            ${Number.isFinite(row.profitHour)
                                                ? signedMoneyPerHour(row.profitHour)
                                                : 'N/A'}
                                        </td>
                                        <td class="tqm-best">
                                            ${renderPriceSource(
                                                row.outputSale?.source || 'N/A',
                                                [
                                                    row.outputRecord,
                                                    row.inputRecord
                                                ],
                                                {
                                                    skill: 'crafting',
                                                    includeInventory: true
                                                }
                                            )}
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </section>

                <section class="tqm-card">
                    <div class="tqm-section-heading-row">
                        <div>
                            <h2>Crafting — Repair Kits &amp; Crates</h2>
                            <p class="tqm-note">
                                Repair kits, restoration kits, and refit crates now have their own Crafting profit table.
                            </p>
                        </div>
                        <div class="tqm-best-port-badge">
                            <span>Best Crafting Port</span>
                            <strong>${escapeHtml(bestCityForSkill('crafting'))}</strong>
                        </div>
                    </div>
                    ${genericProfitTable(repairRows)}
                </section>
            </div>
        `;
    }

    function calculateCannonProfitRows() {
        const recipes = plannerRecipeCatalog().filter(recipe =>
            recipe.skill === 'smithing' &&
            String(recipe.id || '').startsWith('smithing:cannon:')
        );

        return calculateGenericRecipeProfitRows(recipes);
    }

    function renderSmithingSkill() {
        const cannonRows = calculateCannonProfitRows();

        return `
            ${renderAmmunition()}
            <section class="tqm-card">
                <div class="tqm-section-heading-row">
                    <div>
                        <h2>Cannon Smithing Profit</h2>
                        <p class="tqm-note">
                            Cannons are shown here with ammunition because both use the Smithing skill.
                        </p>
                    </div>
                </div>
                ${genericProfitTable(cannonRows)}
            </section>
        `;
    }


    const SIMULATED_MASTERY_SKILLS = [
        'logging',
        'mining',
        'fishing',
        'carpentry',
        'smelting',
        'crafting',
        'cooking',
        'smithing'
    ];

    function withTemporaryMastery(skill, tracks, callback) {
        const previous = {
            experience: experienceMasteryPoints(skill),
            yield: yieldMasteryPoints(skill)
        };

        try {
            state.mastery[skill] = {
                experience: Math.max(
                    0,
                    Math.min(
                        9,
                        Math.floor(Number(tracks?.experience) || 0)
                    )
                ),
                yield: Math.max(
                    0,
                    Math.min(
                        9,
                        Math.floor(Number(tracks?.yield) || 0)
                    )
                )
            };
            return callback();
        } finally {
            state.mastery[skill] = previous;
        }
    }

    function masterySkillLabel(skill) {
        return String(skill || '')
            .replace(/^./, character => character.toUpperCase());
    }

    function simulatorPointsForSkill(skill) {
        const simulator = state.masterySimulator || {};
        const allocations = simulator.allocations || {};
        const stored = allocations[skill];

        if (stored && typeof stored === 'object') {
            return {
                experiencePoints: Math.max(
                    0,
                    Math.min(
                        9,
                        Math.floor(
                            Number(stored.experiencePoints) || 0
                        )
                    )
                ),
                yieldPoints: Math.max(
                    0,
                    Math.min(
                        9,
                        Math.floor(
                            Number(stored.yieldPoints) || 0
                        )
                    )
                )
            };
        }

        /*
         * Migration from the previous one-skill simulator.
         */
        if (simulator.skill === skill) {
            return {
                experiencePoints: Math.max(
                    0,
                    Math.min(
                        9,
                        Math.floor(
                            Number(simulator.experiencePoints) ||
                            experienceMasteryPoints(skill)
                        )
                    )
                ),
                yieldPoints: Math.max(
                    0,
                    Math.min(
                        9,
                        Math.floor(
                            Number(simulator.yieldPoints) ||
                            yieldMasteryPoints(skill)
                        )
                    )
                )
            };
        }

        return {
            experiencePoints:
                experienceMasteryPoints(skill),
            yieldPoints:
                yieldMasteryPoints(skill)
        };
    }

    function supportedXpRowsForSkill(skill) {
        const level = Math.max(
            1,
            Number(state.skillLevels[skill] || 1)
        );

        return BUILT_IN_XP_RECIPES
            .filter(recipe =>
                recipe.skill === skill &&
                Number(recipe.level || 1) <= level
            )
            .map(recipe => ({
                ...recipe,
                cycleAdjusted: adjustedCraftTime(
                    recipe.cycle,
                    recipe.skill
                )
            }));
    }

    function bestMasteryXpOpportunity(skill, experiencePoints) {
        const points = Math.max(
            0,
            Math.min(9, Number(experiencePoints) || 0)
        );

        return supportedXpRowsForSkill(skill)
            .map(recipe => {
                const xpPerAction =
                    Number(recipe.xp || 0) + points;
                const xpPerHour =
                    recipe.cycleAdjusted > 0
                        ? xpPerAction * 3600 /
                            recipe.cycleAdjusted
                        : 0;

                return {
                    item: recipe.item,
                    baseXp: Number(recipe.xp || 0),
                    xpPerAction,
                    xpPerHour,
                    cycle: recipe.cycleAdjusted
                };
            })
            .sort((a, b) => b.xpPerHour - a.xpPerHour)[0] || null;
    }

    function gatheringOpportunity(skill) {
        return supportedXpRowsForSkill(skill)
            .map(recipe => {
                const outputQuantity = yieldMultiplier(skill);
                const outputRecord = findItemPrice([recipe.item]);
                const outputSale = bestAvailableSaleValue(
                    outputRecord,
                    outputQuantity
                );
                const outputValue = outputSale.value;

                const inputCost = (recipe.ingredients || [])
                    .reduce((total, ingredient) => {
                        const inputRecord = findItemPrice([
                            ingredient.name
                        ]);
                        const input = exchangeBuyCost(
                            inputRecord,
                            Number(ingredient.quantity || 0)
                        );

                        return Number.isFinite(input.value)
                            ? total + input.value
                            : NaN;
                    }, 0);

                const profitPerAction =
                    Number.isFinite(outputValue) &&
                    Number.isFinite(inputCost)
                        ? outputValue - inputCost
                        : NaN;
                const goldPerHour =
                    recipe.cycleAdjusted > 0 &&
                    Number.isFinite(profitPerAction)
                        ? profitPerAction * 3600 /
                            recipe.cycleAdjusted
                        : NaN;

                return {
                    item: recipe.item,
                    value: goldPerHour,
                    source: outputSale.source
                };
            })
            .filter(row => Number.isFinite(row.value))
            .sort((a, b) => b.value - a.value)[0] || null;
    }

    function bestMasteryOpportunity(skill) {
        if (
            skill === 'logging' ||
            skill === 'mining' ||
            skill === 'fishing'
        ) {
            return gatheringOpportunity(skill);
        }

        /*
         * Carpentry/smelting/crafting reuse the same net-of-input-cost
         * profitHour figures the Wood/Metal tabs already compute, rather
         * than re-deriving from raw sale value (which would double-count
         * the crafted output as pure profit without subtracting the
         * log/ore/bar it consumed).
         */
        if (skill === 'carpentry') {
            return calculateWoodRows()
                .flatMap(row => [
                    {
                        item: `${row.material} Log → Planks`,
                        value: row.plankProfitHour,
                        source:
                            row.plankRecommendation?.source ||
                            'Unavailable'
                    },
                    {
                        item: `${row.material} Planks → Beams`,
                        value: row.beamProfitHour,
                        source:
                            row.beamRecommendation?.source ||
                            'Unavailable'
                    }
                ])
                .filter(row => Number.isFinite(row.value))
                .sort((a, b) => b.value - a.value)[0] || null;
        }

        if (skill === 'smelting') {
            return calculateMetalRows()
                .map(row => ({
                    item: `${row.material} Ore → Bars`,
                    value: row.barProfitHour,
                    source:
                        row.barRecommendation?.source ||
                        'Unavailable'
                }))
                .filter(row => Number.isFinite(row.value))
                .sort((a, b) => b.value - a.value)[0] || null;
        }

        if (skill === 'crafting') {
            return calculateMetalRows()
                .map(row => ({
                    item: `${row.material} Bar → Nails`,
                    value: row.nailProfitHour,
                    source:
                        row.nailRecommendation?.source ||
                        'Unavailable'
                }))
                .filter(row => Number.isFinite(row.value))
                .sort((a, b) => b.value - a.value)[0] || null;
        }

        if (skill === 'cooking') {
            return calculateCookingRows()
                .map(row => ({
                    item: `${row.ingredient} → ${row.item}`,
                    value: Number(
                        row.bestFromScratch?.goldPerHour
                    ),
                    source:
                        row.bestFromScratch?.choice ||
                        'Unavailable'
                }))
                .filter(row => Number.isFinite(row.value))
                .sort((a, b) => b.value - a.value)[0] || null;
        }

        /*
         * Smithing is intentionally process-only: its supported recipes begin
         * with bars already owned or purchased, not a direct gathering action.
         */
        if (skill === 'smithing') {
            return calculateAmmunitionRows()
                .map(row => ({
                    item: row.itemName,
                    value: Number(row.profitHour || 0)
                }))
                .sort((a, b) => b.value - a.value)[0] || null;
        }

        return null;
    }

    function masterySkillsForBuyCraftOpportunity(opportunity) {
        const type = String(opportunity?.type || '');
        const item = String(opportunity?.item || '');

        if (type === 'Wood') {
            return ['carpentry'];
        }

        if (type === 'Cooking') {
            return ['cooking'];
        }

        if (type === 'Ammunition') {
            return ['smelting', 'smithing'];
        }

        if (type === 'Metal') {
            return /Nails$/i.test(item)
                ? ['smelting', 'crafting']
                : ['smelting'];
        }

        return [];
    }

    function summarizeBuyCraftMasteryOpportunities(opportunities) {
        const profitable = (opportunities || [])
            .filter(opportunity =>
                Number.isFinite(Number(opportunity?.perHour)) &&
                Number(opportunity.perHour) > 0
            )
            .sort((a, b) =>
                Number(b.perHour || 0) - Number(a.perHour || 0) ||
                Number(b.roi || 0) - Number(a.roi || 0)
            );
        const bySkill = new Map();

        profitable.forEach(opportunity => {
            masterySkillsForBuyCraftOpportunity(opportunity)
                .forEach(skill => {
                    if (bySkill.has(skill)) return;

                    bySkill.set(skill, {
                        item: opportunity.item,
                        route: opportunity.route,
                        value: Number(opportunity.perHour || 0),
                        roi: Number(opportunity.roi || 0),
                        profit: Number(opportunity.profit || 0),
                        inputCost: Number(opportunity.inputCost || 0),
                        outputValue: Number(opportunity.outputValue || 0),
                        fee: Number(opportunity.fee || 0),
                        masteries:
                            masterySkillsForBuyCraftOpportunity(opportunity),
                        saleSource: opportunity.saleSource || ''
                    });
                });
        });

        const top = profitable[0]
            ? {
                item: profitable[0].item,
                route: profitable[0].route,
                value: Number(profitable[0].perHour || 0),
                roi: Number(profitable[0].roi || 0),
                profit: Number(profitable[0].profit || 0),
                inputCost: Number(profitable[0].inputCost || 0),
                outputValue: Number(profitable[0].outputValue || 0),
                fee: Number(profitable[0].fee || 0),
                masteries:
                    masterySkillsForBuyCraftOpportunity(profitable[0]),
                saleSource: profitable[0].saleSource || ''
            }
            : null;

        return { top, bySkill };
    }

    function withTemporaryMasteryAllocations(
        allocations,
        callback
    ) {
        const previous = {};

        SIMULATED_MASTERY_SKILLS.forEach(skill => {
            previous[skill] = {
                experience:
                    experienceMasteryPoints(skill),
                yield:
                    yieldMasteryPoints(skill)
            };

            const points = allocations[skill] ||
                simulatorPointsForSkill(skill);

            state.mastery[skill] = {
                experience: Math.max(
                    0,
                    Math.min(
                        9,
                        Math.floor(
                            Number(points.experiencePoints) || 0
                        )
                    )
                ),
                yield: Math.max(
                    0,
                    Math.min(
                        9,
                        Math.floor(
                            Number(points.yieldPoints) || 0
                        )
                    )
                )
            };
        });

        try {
            return callback();
        } finally {
            SIMULATED_MASTERY_SKILLS.forEach(skill => {
                state.mastery[skill] = previous[skill];
            });
        }
    }

    function masterySimulatorAllocations() {
        const allocations = {};

        SIMULATED_MASTERY_SKILLS.forEach(skill => {
            allocations[skill] =
                simulatorPointsForSkill(skill);
        });

        return allocations;
    }

    function calculateMasterySimulation() {
        const allocations = masterySimulatorAllocations();
        const currentShip = calculateShipBuild();
        const buyCraftEnabled = Boolean(
            state.preferences?.showBuyCraftRecommendations
        );
        const currentBuyCraftSummary = buyCraftEnabled
            ? summarizeBuyCraftMasteryOpportunities(
                calculateBuyAndCraftOpportunities()
            )
            : { top: null, bySkill: new Map() };

        const currentRows = SIMULATED_MASTERY_SKILLS.map(skill => ({
            skill,
            currentExperience:
                experienceMasteryPoints(skill),
            currentYield:
                yieldMasteryPoints(skill),
            simulatedExperience:
                allocations[skill].experiencePoints,
            simulatedYield:
                allocations[skill].yieldPoints,
            currentXp:
                bestMasteryXpOpportunity(
                    skill,
                    experienceMasteryPoints(skill)
                ),
            currentGold:
                bestMasteryOpportunity(skill),
            currentBuyCraftGold:
                currentBuyCraftSummary.bySkill.get(skill) || null
        }));

        const simulated = withTemporaryMasteryAllocations(
            allocations,
            () => {
                const buyCraftSummary = buyCraftEnabled
                    ? summarizeBuyCraftMasteryOpportunities(
                        calculateBuyAndCraftOpportunities()
                    )
                    : { top: null, bySkill: new Map() };

                return {
                    ship: calculateShipBuild(),
                    buyCraftSummary,
                    rows: SIMULATED_MASTERY_SKILLS.map(skill => ({
                        skill,
                        xp: bestMasteryXpOpportunity(
                            skill,
                            allocations[skill].experiencePoints
                        ),
                        gold: bestMasteryOpportunity(skill),
                        buyCraftGold:
                            buyCraftSummary.bySkill.get(skill) || null
                    }))
                };
            }
        );

        const simulatedBySkill = new Map(
            simulated.rows.map(row => [row.skill, row])
        );

        const rows = currentRows.map(row => {
            const simulatedRow =
                simulatedBySkill.get(row.skill) || {};

            return {
                ...row,
                simulatedXp: simulatedRow.xp || null,
                simulatedGold: simulatedRow.gold || null,
                simulatedBuyCraftGold:
                    simulatedRow.buyCraftGold || null
            };
        });

        const buyCraftRows = rows.filter(row =>
            ['carpentry', 'smelting', 'crafting', 'cooking', 'smithing']
                .includes(row.skill)
        );

        const investedPoints = Object.values(allocations)
            .reduce(
                (sum, points) =>
                    sum +
                    Number(points.experiencePoints || 0) +
                    Number(points.yieldPoints || 0),
                0
            );

        return {
            allocations,
            rows,
            buyCraftEnabled,
            buyCraftRows,
            currentBuyCraftTop: currentBuyCraftSummary.top,
            simulatedBuyCraftTop: simulated.buyCraftSummary.top,
            investedPoints,
            currentShip,
            simulatedShip: simulated.ship,
            shipDifferences: {
                logs: Math.max(
                    0,
                    Number(currentShip.totalLogsNeeded || 0) -
                    Number(simulated.ship.totalLogsNeeded || 0)
                ),
                ore: Math.max(
                    0,
                    Number(currentShip.totalOreNeeded || 0) -
                    Number(simulated.ship.totalOreNeeded || 0)
                ),
                bars: Math.max(
                    0,
                    Number(currentShip.totalBarsNeeded || 0) -
                    Number(simulated.ship.totalBarsNeeded || 0)
                ),
                seconds: Math.max(
                    0,
                    Number(currentShip.totalCraftSeconds || 0) -
                    Number(simulated.ship.totalCraftSeconds || 0)
                )
            }
        };
    }

    function renderMasterySimulator() {
        const result = calculateMasterySimulation();

        return `
            <section class="tqm-card">
                <div class="tqm-section-heading-row">
                    <div>
                        <h2>Mastery Simulator</h2>
                        <p class="tqm-note">
                            Adjust multiple professions at the same time.
                            Experience adds +1 XP per action per point.
                            Yield adds +20% output per point.
                            ${result.buyCraftEnabled
                                ? 'Purchased-material net profit is included below.'
                                : ''}
                        </p>
                    </div>

                    <div class="tqm-mastery-simulator-toolbar">
                        <span>
                            <strong>${result.investedPoints}</strong>
                            simulated points
                        </span>
                        <button type="button" class="tqm-reset-all-mastery">
                            Reset All
                        </button>
                    </div>
                </div>

                <div class="tqm-mastery-skill-grid">
                    ${result.rows.map(row => {
                        const label =
                            masterySkillLabel(row.skill);

                        return `
                            <article class="tqm-mastery-skill-card">
                                <div class="tqm-mastery-skill-card-heading">
                                    <div>
                                        <h3>${escapeHtml(label)}</h3>
                                        <small>
                                            Current XP ${row.currentExperience}
                                            · Yield +${row.currentYield * 20}%
                                        </small>
                                    </div>
                                    <button
                                        type="button"
                                        class="tqm-mastery-reset-icon"
                                        data-tqm-reset-mastery-skill="${row.skill}"
                                        title="Reset ${escapeHtml(label)}"
                                        aria-label="Reset ${escapeHtml(label)}"
                                    >
                                        ↺
                                    </button>
                                </div>

                                <div class="tqm-mastery-stepper-row">
                                    <span>XP</span>

                                    <div class="tqm-mastery-stepper">
                                        <button
                                            type="button"
                                            data-tqm-step-skill="${row.skill}"
                                            data-tqm-step-track="experiencePoints"
                                            data-tqm-step-direction="-1"
                                            aria-label="Decrease ${escapeHtml(label)} XP mastery"
                                        >
                                            −
                                        </button>

                                        <input
                                            type="number"
                                            min="0"
                                            max="9"
                                            step="1"
                                            value="${row.simulatedExperience}"
                                            data-tqm-simulator-skill="${row.skill}"
                                            data-tqm-simulator-track="experiencePoints"
                                            aria-label="${escapeHtml(label)} XP mastery points"
                                        >

                                        <button
                                            type="button"
                                            data-tqm-step-skill="${row.skill}"
                                            data-tqm-step-track="experiencePoints"
                                            data-tqm-step-direction="1"
                                            aria-label="Increase ${escapeHtml(label)} XP mastery"
                                        >
                                            +
                                        </button>
                                    </div>

                                    <strong>
                                        +${row.simulatedExperience} XP
                                    </strong>
                                </div>

                                <div class="tqm-mastery-stepper-row">
                                    <span>Yield</span>

                                    <div class="tqm-mastery-stepper">
                                        <button
                                            type="button"
                                            data-tqm-step-skill="${row.skill}"
                                            data-tqm-step-track="yieldPoints"
                                            data-tqm-step-direction="-1"
                                            aria-label="Decrease ${escapeHtml(label)} Yield mastery"
                                        >
                                            −
                                        </button>

                                        <input
                                            type="number"
                                            min="0"
                                            max="9"
                                            step="1"
                                            value="${row.simulatedYield}"
                                            data-tqm-simulator-skill="${row.skill}"
                                            data-tqm-simulator-track="yieldPoints"
                                            aria-label="${escapeHtml(label)} Yield mastery points"
                                        >

                                        <button
                                            type="button"
                                            data-tqm-step-skill="${row.skill}"
                                            data-tqm-step-track="yieldPoints"
                                            data-tqm-step-direction="1"
                                            aria-label="Increase ${escapeHtml(label)} Yield mastery"
                                        >
                                            +
                                        </button>
                                    </div>

                                    <strong>
                                        +${row.simulatedYield * 20}%
                                    </strong>
                                </div>
                            </article>
                        `;
                    }).join('')}
                </div>
            </section>

            <section class="tqm-card">
                <h2>Combined Comparison</h2>

                <div class="tqm-comparison-stack">
                    ${result.buyCraftEnabled ? `
                        <section class="tqm-comparison-block">
                            <div class="tqm-section-heading-row">
                                <div>
                                    <h3>Buy Mats &amp; Craft Net Profit</h3>
                                    <p class="tqm-note">
                                        Buys raw materials from active Exchange
                                        sell listings and sells finished goods to
                                        the best active buy order or vendor.
                                    </p>
                                </div>

                                <div class="tqm-best-port-badge">
                                    <span>Best Simulated Route</span>
                                    <strong>
                                        ${escapeHtml(
                                            result.simulatedBuyCraftTop
                                                ? `${result.simulatedBuyCraftTop.masteries
                                                    .map(masterySkillLabel)
                                                    .join(' + ')} · ${result.simulatedBuyCraftTop.item}`
                                                : 'No profitable route'
                                        )}
                                    </strong>
                                    <small>
                                        ${result.simulatedBuyCraftTop
                                            ? moneyPerHour(
                                                result.simulatedBuyCraftTop.value
                                            )
                                            : '—'}
                                    </small>
                                </div>
                            </div>

                            <div class="tqm-table-wrap">
                                <table class="tqm-table tqm-table-compact">
                                    <thead>
                                        <tr>
                                            <th>Mastery</th>
                                            <th>Current Yield</th>
                                            <th>Current Best Net / HR</th>
                                            <th>Current Route</th>
                                            <th>Simulated Yield</th>
                                            <th>Simulated Best Net / HR</th>
                                            <th>Simulated Route</th>
                                            <th>Change</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${result.buyCraftRows.map(row => {
                                            const current =
                                                row.currentBuyCraftGold;
                                            const simulated =
                                                row.simulatedBuyCraftGold;
                                            const change =
                                                Number(simulated?.value || 0) -
                                                Number(current?.value || 0);

                                            return `
                                                <tr>
                                                    <td>
                                                        <strong>
                                                            ${escapeHtml(
                                                                masterySkillLabel(
                                                                    row.skill
                                                                )
                                                            )}
                                                        </strong>
                                                    </td>
                                                    <td>
                                                        +${row.currentYield * 20}%
                                                    </td>
                                                    <td>
                                                        ${current
                                                            ? `${moneyPerHour(
                                                                current.value
                                                            )} · ${formatPercent(
                                                                current.roi
                                                            )} ROI`
                                                            : '—'}
                                                    </td>
                                                    <td class="tqm-reference-item">
                                                        ${current
                                                            ? `<strong>${escapeHtml(
                                                                current.item
                                                            )}</strong><small>${escapeHtml(
                                                                current.route
                                                            )}</small><small>Buy ${formatGold(
                                                                current.inputCost,
                                                                { allowZero: true }
                                                            )} · Sell ${formatGold(
                                                                current.outputValue,
                                                                { allowZero: true }
                                                            )}</small>`
                                                            : '—'}
                                                    </td>
                                                    <td>
                                                        +${row.simulatedYield * 20}%
                                                    </td>
                                                    <td class="tqm-profit-positive">
                                                        ${simulated
                                                            ? `${moneyPerHour(
                                                                simulated.value
                                                            )} · ${formatPercent(
                                                                simulated.roi
                                                            )} ROI`
                                                            : '—'}
                                                    </td>
                                                    <td class="tqm-reference-item">
                                                        ${simulated
                                                            ? `<strong>${escapeHtml(
                                                                simulated.item
                                                            )}</strong><small>${escapeHtml(
                                                                simulated.route
                                                            )}</small><small>Buy ${formatGold(
                                                                simulated.inputCost,
                                                                { allowZero: true }
                                                            )} · Sell ${formatGold(
                                                                simulated.outputValue,
                                                                { allowZero: true }
                                                            )}</small>`
                                                            : '—'}
                                                    </td>
                                                    <td class="${
                                                        change >= 0
                                                            ? 'tqm-profit-positive'
                                                            : 'tqm-profit-negative'
                                                    }">
                                                        ${signedMoneyPerHour(change)}
                                                    </td>
                                                </tr>
                                            `;
                                        }).join('')}
                                    </tbody>
                                </table>
                            </div>
                        </section>
                    ` : ''}

                    <section class="tqm-comparison-block">
                        <h3>Gold Comparison</h3>

                        <div class="tqm-table-wrap">
                            <table class="tqm-table tqm-table-compact">
                                <thead>
                                    <tr>
                                        <th>Profession</th>
                                        <th>Current</th>
                                        <th>Simulated</th>
                                        <th>Best Current Gold / HR</th>
                                        <th>Current Gold Item</th>
                                        <th>Best Simulated Gold / HR</th>
                                        <th>Simulated Gold Item</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${result.rows.map(row => `
                                        <tr>
                                            <td>
                                                <strong>
                                                    ${escapeHtml(
                                                        masterySkillLabel(
                                                            row.skill
                                                        )
                                                    )}
                                                </strong>
                                            </td>
                                            <td>
                                                XP ${row.currentExperience}
                                                · Yield +${row.currentYield * 20}%
                                            </td>
                                            <td>
                                                XP ${row.simulatedExperience}
                                                · Yield +${row.simulatedYield * 20}%
                                            </td>
                                            <td>
                                                ${
                                                    row.currentGold
                                                        ? moneyPerHour(
                                                            row.currentGold
                                                                .value
                                                        )
                                                        : '—'
                                                }
                                            </td>
                                            <td class="tqm-reference-item">
                                                ${escapeHtml(
                                                    row.currentGold?.item ||
                                                    row.currentGold?.source ||
                                                    '—'
                                                )}
                                            </td>
                                            <td class="tqm-profit-positive">
                                                ${
                                                    row.simulatedGold
                                                        ? moneyPerHour(
                                                            row.simulatedGold
                                                                .value
                                                        )
                                                        : '—'
                                                }
                                            </td>
                                            <td class="tqm-reference-item">
                                                ${escapeHtml(
                                                    row.simulatedGold?.item ||
                                                    row.simulatedGold?.source ||
                                                    '—'
                                                )}
                                            </td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </section>

                    <section class="tqm-comparison-block">
                        <h3>Experience Comparison</h3>

                        <div class="tqm-table-wrap">
                            <table class="tqm-table tqm-table-compact">
                                <thead>
                                    <tr>
                                        <th>Profession</th>
                                        <th>Current</th>
                                        <th>Simulated</th>
                                        <th>Best Current XP / HR</th>
                                        <th>Current XP Item</th>
                                        <th>Best Simulated XP / HR</th>
                                        <th>Simulated XP Item</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${result.rows.map(row => `
                                        <tr>
                                            <td>
                                                <strong>
                                                    ${escapeHtml(
                                                        masterySkillLabel(
                                                            row.skill
                                                        )
                                                    )}
                                                </strong>
                                            </td>
                                            <td>
                                                XP ${row.currentExperience}
                                                · Yield +${row.currentYield * 20}%
                                            </td>
                                            <td>
                                                XP ${row.simulatedExperience}
                                                · Yield +${row.simulatedYield * 20}%
                                            </td>
                                            <td>
                                                ${
                                                    row.currentXp
                                                        ? formatXpPerHour(
                                                            row.currentXp
                                                                .xpPerHour
                                                        )
                                                        : '—'
                                                }
                                            </td>
                                            <td class="tqm-reference-item">
                                                ${escapeHtml(
                                                    row.currentXp?.item ||
                                                    '—'
                                                )}
                                            </td>
                                            <td class="tqm-profit-positive">
                                                ${
                                                    row.simulatedXp
                                                        ? formatXpPerHour(
                                                            row.simulatedXp
                                                                .xpPerHour
                                                        )
                                                        : '—'
                                                }
                                            </td>
                                            <td class="tqm-reference-item">
                                                ${escapeHtml(
                                                    row.simulatedXp?.item ||
                                                    '—'
                                                )}
                                            </td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </section>
                </div>
            </section>

            <section class="tqm-card">
                <div class="tqm-section-heading-row">
                    <div>
                        <h2>Combined Ship Builder Impact</h2>
                        <p class="tqm-note">
                            Applies Carpentry, Smelting, and Crafting Yield
                            simulations together to the selected ship.
                        </p>
                    </div>

                    <div class="tqm-best-port-badge">
                        <span>Current Build</span>
                        <strong>
                            ${escapeHtml(
                                result.currentShip.name ||
                                'Custom Ship'
                            )}
                        </strong>
                    </div>
                </div>

                <div class="tqm-table-wrap">
                    <table class="tqm-table tqm-table-compact">
                        <thead>
                            <tr>
                                <th>Requirement</th>
                                <th>Current</th>
                                <th>Simulated</th>
                                <th>Saved</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>
                                    <strong>
                                        ${escapeHtml(
                                            result.currentShip.wood
                                        )} Logs
                                    </strong>
                                </td>
                                <td>
                                    ${Math.ceil(
                                        result.currentShip.totalLogsNeeded
                                    ).toLocaleString()}
                                </td>
                                <td>
                                    ${Math.ceil(
                                        result.simulatedShip.totalLogsNeeded
                                    ).toLocaleString()}
                                </td>
                                <td class="tqm-profit-positive">
                                    ${Math.ceil(
                                        result.shipDifferences.logs
                                    ).toLocaleString()}
                                </td>
                            </tr>
                            <tr>
                                <td>
                                    <strong>
                                        ${escapeHtml(
                                            result.currentShip.metal
                                        )} Ore
                                    </strong>
                                </td>
                                <td>
                                    ${Math.ceil(
                                        result.currentShip.totalOreNeeded
                                    ).toLocaleString()}
                                </td>
                                <td>
                                    ${Math.ceil(
                                        result.simulatedShip.totalOreNeeded
                                    ).toLocaleString()}
                                </td>
                                <td class="tqm-profit-positive">
                                    ${Math.ceil(
                                        result.shipDifferences.ore
                                    ).toLocaleString()}
                                </td>
                            </tr>
                            <tr>
                                <td><strong>Bars Required</strong></td>
                                <td>
                                    ${Math.ceil(
                                        result.currentShip.totalBarsNeeded
                                    ).toLocaleString()}
                                </td>
                                <td>
                                    ${Math.ceil(
                                        result.simulatedShip.totalBarsNeeded
                                    ).toLocaleString()}
                                </td>
                                <td class="tqm-profit-positive">
                                    ${Math.ceil(
                                        result.shipDifferences.bars
                                    ).toLocaleString()}
                                </td>
                            </tr>
                            <tr>
                                <td><strong>Craft Time</strong></td>
                                <td>
                                    ${formatSeconds(
                                        result.currentShip.totalCraftSeconds
                                    )}
                                </td>
                                <td>
                                    ${formatSeconds(
                                        result.simulatedShip.totalCraftSeconds
                                    )}
                                </td>
                                <td class="tqm-profit-positive">
                                    ${formatSeconds(
                                        result.shipDifferences.seconds
                                    )}
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </section>
        `;
    }

    function applyQuartermasterPreferences() {
        const overlay = document.getElementById(OVERLAY_ID);
        if (!overlay) return;

        const preferences = {
            ...DEFAULT_STATE.preferences,
            ...(state.preferences || {})
        };

        overlay.classList.toggle(
            'tqm-compact-mode',
            Boolean(preferences.compactMode)
        );
        overlay.classList.toggle(
            'tqm-theme-classic',
            preferences.theme === 'classic'
        );
        overlay.classList.toggle(
            'tqm-hide-locked-skill-rows',
            !preferences.showLockedSkillRows
        );
        overlay.dataset.tqmFontSize =
            ['small', 'normal', 'large'].includes(preferences.fontSize)
                ? preferences.fontSize
                : 'normal';
    }

    function quartermasterStatusData() {
        const priceRows = Object.values(state.prices || {});
        const exchangeRows = priceRows.filter(row =>
            Number(row.ask || 0) > 0 ||
            Number(row.bid || 0) > 0 ||
            Number(row.lastSold || 0) > 0 ||
            Number(row.weeklyVolume || 0) > 0
        );
        const vendorRows = priceRows.filter(
            row => Number(row.vendorPrice || 0) > 0
        );

        return {
            exchangeRows: exchangeRows.length,
            vendorRows: vendorRows.length,
            masteryLoaded: Number(state.masteryUpdatedAt || 0) > 0,
            levelCount: Object.values(state.skillLevels || {})
                .filter(level => Number(level || 0) > 0).length,
            inventoryItems: Object.keys(
                state.inventoryCache?.items || {}
            ).length,
            inventoryLoaded:
                Number(state.inventoryCache?.updatedAt || 0) > 0,
            recipeCount: BUILT_IN_XP_RECIPES.length,
            shipCount: SHIP_PRESETS.length,
            cityCount: Object.keys(CITY_BONUSES).length
        };
    }

    function formatSettingsTimestamp(value) {
        const timestamp = Number(value || 0);
        if (!timestamp) return 'Not loaded';

        return new Date(timestamp).toLocaleString([], {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        });
    }

    function downloadQuartermasterFile(
        filename,
        data,
        type = 'application/json'
    ) {
        const blob = new Blob([data], { type });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');

        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function renderMastery() {
        preloadKnownVendorPrices();
        const professionSkills = [
            'logging', 'mining', 'fishing', 'carpentry', 'smelting',
            'cooking', 'smithing', 'gunnery', 'crafting', 'navigation'
        ];
        const status = quartermasterStatusData();
        const preferences = {
            ...DEFAULT_STATE.preferences,
            ...(state.preferences || {})
        };

        return `
            <section class="tqm-card tqm-settings-overview">
                <div class="tqm-section-heading-row">
                    <div>
                        <h2>Quartermaster Settings</h2>
                        <p class="tqm-note">
                            Status, data sources, planner behavior, appearance,
                            maintenance, and diagnostics.
                        </p>
                    </div>
                    <div class="tqm-best-port-badge">
                        <span>Version</span>
                        <strong>${VERSION}</strong>
                    </div>
                </div>

                <div class="tqm-settings-status-grid">
                    <div class="${status.exchangeRows ? 'tqm-status-ok' : 'tqm-status-needed'}">
                        <span>Exchange Prices</span>
                        <strong>${status.exchangeRows} items</strong>
                        <small>${formatSettingsTimestamp(state.updatedAt)}</small>
                    </div>
                    <div class="${status.vendorRows ? 'tqm-status-ok' : 'tqm-status-needed'}">
                        <span>Vendor Prices</span>
                        <strong>${status.vendorRows} items</strong>
                        <small>Built-in values protected</small>
                    </div>
                    <div class="${status.masteryLoaded ? 'tqm-status-ok' : 'tqm-status-needed'}">
                        <span>Mastery</span>
                        <strong>${status.masteryLoaded ? 'Loaded' : 'Not loaded'}</strong>
                        <small>${formatSettingsTimestamp(state.masteryUpdatedAt)}</small>
                    </div>
                    <div class="${status.inventoryLoaded ? 'tqm-status-ok' : 'tqm-status-needed'}">
                        <span>Inventory</span>
                        <strong>${status.inventoryItems} items</strong>
                        <small>${formatSettingsTimestamp(state.inventoryCache?.updatedAt)}</small>
                    </div>
                </div>
            </section>

            <div class="tqm-settings-layout">
                <section class="tqm-card">
                    <div class="tqm-section-title-row">
                        <div>
                            <h2>Mastery</h2>
                            <p class="tqm-note tqm-compact-note">
                                Open Command → Mastery to read Experience and Yield.
                            </p>
                        </div>
                        <button class="tqm-action" id="tqm-read-mastery">
                            Read Mastery
                        </button>
                    </div>

                    <div class="tqm-detected-mastery">
                        ${MASTERY_SKILLS.map(skill => `
                            <div class="tqm-mastery-readout">
                                <span>${escapeHtml(
                                    skill[0].toUpperCase() + skill.slice(1)
                                )}</span>
                                <strong>+${experienceMasteryPoints(skill)} XP</strong>
                                <strong>+${yieldMasteryPercent(skill)}% Yield</strong>
                            </div>
                        `).join('')}
                    </div>

                    <div class="tqm-settings-button-row">
                        <button
                            class="tqm-action tqm-secondary"
                            id="tqm-clear-mastery"
                            type="button"
                        >
                            Clear Mastery
                        </button>
                    </div>
                </section>

                <section class="tqm-card">
                    <h2>Price Cache</h2>
                    <p class="tqm-note tqm-compact-note">
                        Exchange profit remains strict. Gold-per-hour
                        recommendations use the better valid result from
                        Exchange or Vendor.
                    </p>

                    <div class="tqm-settings-metric-list">
                        <div><span>Exchange items</span><strong>${status.exchangeRows}</strong></div>
                        <div><span>Vendor items</span><strong>${status.vendorRows}</strong></div>
                        <div>
                            <span>Exchange tax</span>
                            <label class="tqm-inline-number-setting">
                                <input id="tqm-tax" type="number" min="0" max="100" value="${state.taxPercent}">
                                <b>%</b>
                            </label>
                        </div>
                    </div>

                    <div class="tqm-settings-button-row">
                        <button class="tqm-action tqm-secondary" id="tqm-settings-read-exchange">
                            Read Exchange
                        </button>
                        <button class="tqm-action tqm-secondary" id="tqm-clear-market">
                            Clear Exchange Cache
                        </button>
                    </div>
                </section>

                <section class="tqm-card">
                    <h2>Overview Recommendations</h2>
                    <p class="tqm-note tqm-compact-note">
                        Enable purchased-material profit rankings for players who
                        buy raw materials and craft them for resale. This controls
                        both the Overview rankings and the Mastery Simulator's
                        buy-and-craft net-profit comparison. When disabled, the
                        Overview shows the original Crafting Queue card.
                    </p>

                    <label class="tqm-checkbox-row">
                        <input id="tqm-pref-buy-craft" type="checkbox"
                            ${preferences.showBuyCraftRecommendations ? 'checked' : ''}>
                        <span>Show Buy Mats &amp; Craft recommendations</span>
                    </label>
                </section>

                <section class="tqm-card">
                    <h2>Feature Controls</h2>
                    <p class="tqm-note tqm-compact-note">
                        Turn Quartermaster's newer economy helpers on or off
                        without disabling the main script.
                    </p>

                    ${[
                        [
                            'tqm-pref-item-inspector',
                            'itemInspectorEnabled',
                            'Ctrl Item Inspector',
                            'Hold Ctrl over supported items to open the economy inspector.'
                        ],
                        [
                            'tqm-pref-price-freshness',
                            'showPriceFreshness',
                            'Price freshness',
                            'Show how old Exchange data is in skill tables and the Ctrl inspector.'
                        ],
                        [
                            'tqm-pref-pinned-comparison',
                            'pinnedComparisonEnabled',
                            'Pinned comparison mode',
                            'Pin one inspector and Ctrl-hover another item to compare them.'
                        ],
                        [
                            'tqm-pref-craft-capacity',
                            'showInspectorCraftCapacity',
                            'Max craftable + missing materials',
                            'Show inventory capacity and missing ingredients in the Ctrl inspector.'
                        ],
                        [
                            'tqm-pref-locked-rows',
                            'showLockedSkillRows',
                            'Show locked future tiers',
                            'Keep recipes above your detected skill level visible and dimmed.'
                        ]
                    ].map(([id, key, title, description]) => `
                        <label class="tqm-feature-toggle-row">
                            <input
                                id="${id}"
                                type="checkbox"
                                ${preferences[key] ? 'checked' : ''}
                            >
                            <span>
                                <strong>${title}</strong>
                                <small>${description}</small>
                            </span>
                        </label>
                    `).join('')}
                </section>

                <section class="tqm-card">
                    <h2>Inventory</h2>
                    <p class="tqm-note tqm-compact-note">
                        Reads the current city warehouse and current ship cargo
                        when those panels are visible.
                    </p>

                    <div class="tqm-settings-metric-list">
                        <div><span>Items cached</span><strong>${status.inventoryItems}</strong></div>
                        <div>
                            <span>Last scan</span>
                            <strong>${formatSettingsTimestamp(state.inventoryCache?.updatedAt)}</strong>
                        </div>
                        <div>
                            <span>Accuracy</span>
                            <strong>
                                ${state.inventoryCache?.hasRoundedValues
                                    ? 'Contains rounded stacks'
                                    : 'Exact visible stacks'}
                            </strong>
                        </div>
                    </div>

                    <label class="tqm-checkbox-row">
                        <input id="tqm-pref-auto-inventory" type="checkbox"
                            ${preferences.autoRefreshInventory ? 'checked' : ''}>
                        <span>Automatically refresh while Inventory is visible</span>
                    </label>

                    <div class="tqm-settings-button-row">
                        <button class="tqm-action tqm-secondary" id="tqm-settings-scan-inventory">
                            Scan Now
                        </button>
                        <button class="tqm-action tqm-secondary" id="tqm-clear-inventory-cache">
                            Clear Inventory Cache
                        </button>
                    </div>
                </section>

                <section class="tqm-card">
                    <h2>XP Planner</h2>

                    <label class="tqm-checkbox-row">
                        <input id="tqm-exclude-locked" type="checkbox"
                            ${state.excludeLockedCrafts ? 'checked' : ''}>
                        <span>Exclude actions above detected profession levels</span>
                    </label>

                    <div class="tqm-section-title-row tqm-settings-subheading">
                        <h3>Profession Levels</h3>
                        <button class="tqm-action tqm-secondary" id="tqm-clear-skill-levels">
                            Reset Levels
                        </button>
                    </div>

                    <div class="tqm-level-editor">
                        ${professionSkills.map(skill => {
                            const level = Number(state.skillLevels[skill] || 0);
                            return `
                                <label class="${level > 0 ? '' : 'tqm-level-unknown'}">
                                    <span>${escapeHtml(
                                        skill[0].toUpperCase() + skill.slice(1)
                                    )}</span>
                                    <input
                                        class="tqm-skill-level-input"
                                        data-skill="${escapeHtml(skill)}"
                                        type="number"
                                        min="0"
                                        max="200"
                                        value="${level > 0 ? level : ''}"
                                        placeholder="—"
                                    >
                                </label>
                            `;
                        }).join('')}
                    </div>
                </section>

                <section class="tqm-card">
                    <h2>Ship Planner</h2>

                    ${[
                        ['tqm-pref-warehouse', 'includeWarehouseInventory', 'Include current city warehouse inventory'],
                        ['tqm-pref-ship-inventory', 'includeShipInventory', 'Include current ship cargo'],
                        ['tqm-pref-raw-materials', 'showRawMaterials', 'Show raw-material requirements'],
                        ['tqm-pref-intermediate-materials', 'showIntermediateMaterials', 'Show intermediate materials'],
                        ['tqm-pref-ship-progress', 'showShipProgress', 'Show ship material progress information']
                    ].map(([id, key, label]) => `
                        <label class="tqm-checkbox-row">
                            <input id="${id}" type="checkbox"
                                ${preferences[key] ? 'checked' : ''}>
                            <span>${label}</span>
                        </label>
                    `).join('')}
                </section>



                <section class="tqm-card">
                    <h2>Data Sources</h2>
                    <div class="tqm-data-source-list">
                        <div><strong>Mastery</strong><span>Open Command → Mastery, then press Read Mastery.</span></div>
                        <div><strong>Profession Levels</strong><span>Open the Command skill screen briefly.</span></div>
                        <div><strong>Exchange Prices</strong><span>Open the Exchange table, then press Read Exchange.</span></div>
                        <div><strong>Inventory</strong><span>Open the current city warehouse or ship cargo.</span></div>
                        <div><strong>Vendor Prices</strong><span>Loaded from the built-in static vendor table.</span></div>
                    </div>
                </section>



                <section class="tqm-card">
                    <h2>Diagnostics</h2>
                    <div class="tqm-diagnostics-list">
                        <div><span>Exchange cache</span><strong>${status.exchangeRows} items</strong></div>
                        <div><span>Vendor cache</span><strong>${status.vendorRows} items</strong></div>
                        <div><span>Inventory cache</span><strong>${status.inventoryItems} items</strong></div>
                        <div><span>Profession levels</span><strong>${status.levelCount} detected</strong></div>
                        <div><span>Recipe database</span><strong>${status.recipeCount} recipes</strong></div>
                        <div>
                            <span>Inventory polling</span>
                            <strong>${preferences.autoRefreshInventory ? 'Enabled while visible' : 'Manual only'}</strong>
                        </div>
                    </div>

                    <details class="tqm-advanced-settings">
                        <summary>Developer Tools</summary>
                        <div class="tqm-advanced-settings-body">
                            <label class="tqm-checkbox-row">
                                <input id="tqm-developer-mode" type="checkbox"
                                    ${state.developerMode ? 'checked' : ''}>
                                <span>Developer Mode</span>
                            </label>

                            ${state.developerMode ? `
                                <label class="tqm-feature-toggle-row tqm-dev-feature-toggle">
                                    <input
                                        id="tqm-pref-source-indicators"
                                        type="checkbox"
                                        ${preferences.showCalculationSourceIndicators ? 'checked' : ''}
                                    >
                                    <span>
                                        <strong>Calculation data-source indicators</strong>
                                        <small>
                                            Show small source badges beside calculated results,
                                            such as Live Market, Vendor, Inventory, Mastery,
                                            city bonus, and Recipe DB.
                                        </small>
                                    </span>
                                </label>
                            ` : `
                                <p class="tqm-note tqm-compact-note">
                                    Enable Developer Mode to show calculation
                                    data-source indicators.
                                </p>
                            `}
                        </div>
                    </details>
                </section>


            </div>
        `;
    }

    function renderCaptured() {
        const rows = Object.values(state.prices)
            .sort((a, b) => String(a.name).localeCompare(String(b.name)));

        const vendorCount = rows.filter(
            row => Number(row.vendorPrice || 0) > 0
        ).length;

        return `
            <section class="tqm-card">
                <div class="tqm-section-heading-row">
                    <div>
                        <h2>Captured Exchange Items</h2>
                    </div>

                    <div class="tqm-best-port-badge">
                        <span>Vendor Prices Captured</span>
                        <strong>${vendorCount.toLocaleString()} / ${rows.length.toLocaleString()}</strong>
                    </div>
                </div>

                <p class="tqm-note">
                    Log vendor prices are built in from their verified supply-fee values.
                    Round, Chain, and Grape Shot vendor prices are preloaded by metal tier.
                    Inputs use the lowest active sell listing. Outputs use the better
                    of the highest active buy order after tax or the vendor price.
                    Recent-trade median is used only when neither is available.
                    An ask above five times the strongest bid, recent trade, or vendor
                    reference is treated as an outlier.
                    The scanner is available only in Developer Mode.
                    Scroll inside the table to keep the column header visible.
                </p>

                <div class="tqm-vendor-debug ${
                    state.vendorDebug.saved
                        ? 'tqm-state-positive'
                        : 'tqm-state-warning'
                }">
                    <div>
                        <span>Last Vendor Scan</span>
                        <strong>${escapeHtml(state.vendorDebug.status)}</strong>
                    </div>
                    <div>
                        <span>Item</span>
                        <strong>${
                            state.vendorDebug.itemName
                                ? escapeHtml(state.vendorDebug.itemName)
                                : '—'
                        }</strong>
                    </div>
                    <div>
                        <span>Item ID</span>
                        <strong>${
                            state.vendorDebug.itemId
                                ? Number(state.vendorDebug.itemId).toLocaleString()
                                : '—'
                        }</strong>
                    </div>
                    <div>
                        <span>Raw / Parsed Price</span>
                        <strong>${
                            state.vendorDebug.rawText
                                ? `${escapeHtml(state.vendorDebug.rawText)} → ${
                                    state.vendorDebug.parsedPrice > 0
                                        ? formatGold(state.vendorDebug.parsedPrice)
                                        : 'Failed'
                                }`
                                : '—'
                        }</strong>
                    </div>
                </div>

                <div class="tqm-table-wrap tqm-captured-table-wrap">
                    <table class="tqm-table tqm-captured-table">
                        <thead>
                            <tr>
                                <th>Item</th>
                                <th>Ask</th>
                                <th>Bid</th>
                                <th>Recent Median</th>
                                <th>Vendor Price</th>
                                <th>Weekly Volume</th>
                                <th>Market Status</th>
                                <th>Source</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${
                                rows.length
                                    ? rows.map(row => `
                                        <tr>
                                            <td><strong>${escapeHtml(row.name)}</strong></td>
                                            <td>${formatGold(row.ask)}</td>
                                            <td>${formatGold(row.bid)}</td>
                                            <td>${formatGold(row.lastSold)}</td>
                                            <td class="${
                                                Number(row.vendorPrice || 0) > 0
                                                    ? 'tqm-profit-positive'
                                                    : ''
                                            }">
                                                ${Number(row.vendorPrice||0)>0 ? `${Number(row.vendorPrice).toLocaleString()}g` : '—'}
                                            </td>
                                            <td>${row.weeklyVolume ? Number(row.weeklyVolume).toLocaleString() : '—'}</td>
                                            <td>
                                                ${(() => {
                                                    const analysis = analyzeMarketPrice(row);

                                                    if (analysis.askRejected) {
                                                        return `
                                                            <span class="tqm-market-outlier">
                                                                Ask ignored
                                                            </span>
                                                            <small>
                                                                Using ${escapeHtml(analysis.source)}
                                                            </small>
                                                        `;
                                                    }

                                                    const immediate =
                                                        analyzeImmediateSale(row);
                                                    const buyText =
                                                        analysis.price > 0
                                                            ? `Buy ${formatGold(analysis.price)}`
                                                            : 'Buy N/A';
                                                    const sellText =
                                                        immediate.netUnitValue > 0
                                                            ? `${escapeHtml(immediate.source)} ${formatGold(immediate.netUnitValue)}`
                                                            : 'Sell N/A';

                                                    return `
                                                        <span class="tqm-market-ok">
                                                            ${buyText}
                                                        </span>
                                                        <small>${sellText}</small>
                                                    `;
                                                })()}
                                            </td>
                                            <td>${escapeHtml(row.source || '—')}</td>
                                        </tr>
                                    `).join('')
                                    : '<tr><td colspan="8" class="tqm-empty">No market data captured.</td></tr>'
                            }
                        </tbody>
                    </table>
                </div>
            </section>
        `;
    }

    function updateHeaderStatus() {
        updateHeaderMasteryDisplay();

        const updated = document.querySelector(
            '#tqm-header-updated-value'
        );

        if (updated) {
            updated.textContent = state.updatedAt
                ? new Date(state.updatedAt).toLocaleTimeString([], {
                    hour: 'numeric',
                    minute: '2-digit'
                })
                : 'Not yet';
        }
    }

    function renderActiveTab(tab) {
        updateHeaderStatus();
        applyQuartermasterPreferences();

        const body = document.querySelector('#tqm-content');
        if (!body) return;

        try {
            body.innerHTML =
                tab === 'gathering' ? renderLoggingMining() :
                tab === 'fishing' ? renderFishingSkill() :
                tab === 'carpentry' ? renderCarpentrySkill() :
                tab === 'smelting' ? renderSmeltingSkill() :
                tab === 'smithing' ? renderSmithingSkill() :
                tab === 'cooking' ? renderCooking() :
                tab === 'crafting' ? renderCraftingSkill() :
                tab === 'xp' ? renderXpPlanner() :
                tab === 'planner' ? renderCraftingPlanner() :
                tab === 'simulator' ? renderMasterySimulator() :
                tab === 'ship' ? renderShipBuilder() :
                tab === 'history' ? renderNetWorthHistory() :
                tab === 'mastery' ? renderMastery() :
                tab === 'captured' && state.developerMode
                    ? renderCaptured()
                    : renderOverview();
        } catch (error) {
            console.error('[Tidefall Quartermaster] Tab render failed:', error);

            body.innerHTML = `
                <section class="tqm-card">
                    <h2>Quartermaster Error</h2>
                    <p class="tqm-note">
                        This tab could not be rendered.
                    </p>
                    <pre class="tqm-error-text">${escapeHtml(
                        error?.message || String(error)
                    )}</pre>
                </section>
            `;
        }

        document.querySelectorAll('[data-tqm-tab]').forEach(button => {
            button.classList.toggle('tqm-active', button.dataset.tqmTab === tab);
        });

        bindDynamicEvents();
    }

    function syncDeveloperTab() {
        const nav = document.querySelector('.tqm-tabs');
        if (!nav) return;

        const existing = nav.querySelector('[data-tqm-tab="captured"]');
        const settingsButton = nav.querySelector('[data-tqm-tab="mastery"]');

        if (state.developerMode && !existing) {
            const button = document.createElement('button');
            button.dataset.tqmTab = 'captured';
            button.textContent = 'Captured Data';
            button.addEventListener(
                'click',
                () => renderActiveTab('captured')
            );

            nav.insertBefore(button, settingsButton);
        }

        if (!state.developerMode && existing) {
            const wasActive = existing.classList.contains('tqm-active');
            existing.remove();

            if (wasActive) {
                renderActiveTab('mastery');
            }
        }
    }

    function bindDynamicEvents() {

        document.querySelector('#tqm-planner-group')?.addEventListener(
            'change',
            event => {
                const selectedGroup = event.target.value;
                const firstRecipe = plannerRecipeCatalog().find(
                    recipe => recipe.group === selectedGroup
                );

                state.craftingPlanner = {
                    ...state.craftingPlanner,
                    selectedGroup,
                    selectedRecipe: firstRecipe?.id || ''
                };

                saveState();
                renderActiveTab('planner');
            }
        );

        document.querySelector('#tqm-planner-recipe')?.addEventListener(
            'change',
            event => {
                state.craftingPlanner = {
                    ...state.craftingPlanner,
                    selectedRecipe: event.target.value
                };
                saveState();
            }
        );

        document.querySelector('#tqm-planner-quantity')?.addEventListener(
            'change',
            event => {
                state.craftingPlanner = {
                    ...state.craftingPlanner,
                    quantity: Math.max(
                        1,
                        Math.floor(Number(event.target.value) || 1)
                    )
                };
                saveState();
            }
        );

        document.querySelector('#tqm-planner-add')?.addEventListener(
            'click',
            () => {
                const recipeId =
                    document.querySelector('#tqm-planner-recipe')?.value;
                const quantity = Math.max(
                    1,
                    Math.floor(
                        Number(
                            document.querySelector('#tqm-planner-quantity')
                                ?.value
                        ) || 1
                    )
                );

                if (!plannerRecipeById(recipeId)) {
                    showToast('Select a valid craft.');
                    return;
                }

                const recipe = plannerRecipeById(recipeId);

                state.craftingPlanner = {
                    ...state.craftingPlanner,
                    selectedGroup: recipe?.group || state.craftingPlanner?.selectedGroup,
                    selectedRecipe: recipeId,
                    quantity,
                    queue: [
                        ...(state.craftingPlanner?.queue || []),
                        { recipeId, quantity }
                    ]
                };

                saveState();
                renderActiveTab('planner');
            }
        );

        document.querySelector('#tqm-planner-clear')?.addEventListener(
            'click',
            () => {
                state.craftingPlanner = {
                    ...state.craftingPlanner,
                    queue: []
                };
                saveState();
                renderActiveTab('planner');
            }
        );

        document.querySelectorAll('[data-tqm-planner-remove]').forEach(
            button => {
                button.addEventListener('click', () => {
                    const index = Number(
                        button.dataset.tqmPlannerRemove
                    );
                    const queue = [
                        ...(state.craftingPlanner?.queue || [])
                    ];

                    if (
                        Number.isInteger(index) &&
                        index >= 0 &&
                        index < queue.length
                    ) {
                        queue.splice(index, 1);
                        state.craftingPlanner = {
                            ...state.craftingPlanner,
                            queue
                        };
                        saveState();
                        renderActiveTab('planner');
                    }
                });
            }
        );

        document.querySelectorAll('[data-tqm-networth-range]').forEach(
            button => {
                button.addEventListener('click', () => {
                    state.preferences = {
                        ...state.preferences,
                        netWorthHistoryRange: button.dataset.tqmNetworthRange
                    };

                    saveState();
                    renderActiveTab('history');
                });
            }
        );

        document.querySelector('#tqm-clear-networth-history')
            ?.addEventListener('click', () => {
                state.netWorthHistory = [];
                saveState();
                showToast('Net Worth history cleared.');
                renderActiveTab('history');
            });

        document.querySelector(
            '#tqm-toggle-inventory-panel'
        )?.addEventListener('click', () => {
            scanGameInventory(true);

            state.shipBuilder = {
                ...state.shipBuilder,
                inventoryPanelOpen:
                    !Boolean(state.shipBuilder?.inventoryPanelOpen)
            };
            saveState();
            renderActiveTab('ship');
        });

        document.querySelector(
            '#tqm-refresh-inventory-panel'
        )?.addEventListener('click', event => {
            event.stopPropagation();

            const foundInventory =
                document.querySelector('#inv-wh-grid') ||
                document.querySelector('#inv-cargo-grid');

            if (!foundInventory) {
                showToast(
                    'Open Tidefall Inventory to refresh warehouse and ship cargo.'
                );
                return;
            }

            scanGameInventory(true);
            showToast('Inventory scan refreshed.');
            renderActiveTab('ship');
        });

        document.querySelector(
            '#tqm-close-inventory-panel'
        )?.addEventListener('click', () => {
            state.shipBuilder = {
                ...state.shipBuilder,
                inventoryPanelOpen: false
            };
            saveState();
            renderActiveTab('ship');
        });

        document.querySelectorAll(
            '[data-tqm-floating-inventory]'
        ).forEach(input => {
            input.addEventListener('change', () => {
                const key = input.dataset.tqmFloatingInventory;

                state.shipBuilder = {
                    ...state.shipBuilder,
                    manualInventoryOverride: true,
                    inventory: {
                        ...DEFAULT_STATE.shipBuilder.inventory,
                        ...(state.shipBuilder?.inventory || {}),
                        [key]: positiveNumber(input.value)
                    }
                };

                saveState();
                renderActiveTab('ship');
            });
        });

        (() => {
            const panel = document.querySelector(
                '#tqm-floating-inventory'
            );
            const handle = document.querySelector(
                '#tqm-floating-inventory-drag'
            );

            if (!panel || !handle) return;

            let dragging = false;
            let startX = 0;
            let startY = 0;
            let startLeft = 0;
            let startTop = 0;

            handle.addEventListener('pointerdown', event => {
                if (event.target.closest('button')) return;

                dragging = true;
                startX = event.clientX;
                startY = event.clientY;
                startLeft = panel.offsetLeft;
                startTop = panel.offsetTop;
                handle.setPointerCapture?.(event.pointerId);
                event.preventDefault();
            });

            handle.addEventListener('pointermove', event => {
                if (!dragging) return;

                const maxLeft = Math.max(
                    12,
                    window.innerWidth - panel.offsetWidth - 12
                );
                const maxTop = Math.max(
                    12,
                    window.innerHeight - panel.offsetHeight - 12
                );

                const left = Math.min(
                    maxLeft,
                    Math.max(12, startLeft + event.clientX - startX)
                );
                const top = Math.min(
                    maxTop,
                    Math.max(12, startTop + event.clientY - startY)
                );

                panel.style.left = `${left}px`;
                panel.style.top = `${top}px`;
            });

            const finishDrag = event => {
                if (!dragging) return;
                dragging = false;
                handle.releasePointerCapture?.(event.pointerId);

                state.shipBuilder = {
                    ...state.shipBuilder,
                    inventoryPanelPosition: {
                        left: panel.offsetLeft,
                        top: panel.offsetTop
                    }
                };
                saveState();
            };

            handle.addEventListener('pointerup', finishDrag);
            handle.addEventListener('pointercancel', finishDrag);
        })();

        document.querySelector('#tqm-ship-preset')?.addEventListener(
            'change',
            event => {
                const selectedShip = event.target.value;
                const preset = SHIP_PRESETS[selectedShip];

                if (preset) {
                    state.shipBuilder = {
                        selectedShip,
                        ...preset,
                        inventory: {
                            ...DEFAULT_STATE.shipBuilder.inventory,
                            ...(state.shipBuilder?.inventory || {})
                        },
                        manualInventoryOverride:
                            Boolean(state.shipBuilder?.manualInventoryOverride),
                        inventoryPanelOpen:
                            Boolean(state.shipBuilder?.inventoryPanelOpen),
                        inventoryPanelPosition: {
                            ...DEFAULT_STATE.shipBuilder.inventoryPanelPosition,
                            ...(state.shipBuilder?.inventoryPanelPosition || {})
                        }
                    };
                } else {
                    state.shipBuilder = {
                        ...state.shipBuilder,
                        selectedShip: 'Custom'
                    };
                }

                applyCachedInventoryToShipBuilder();
                saveState();
                renderActiveTab('ship');
            }
        );

        const saveShipBuilder = () => {
            state.shipBuilder = {
                selectedShip: 'Custom',
                name: document.querySelector('#tqm-ship-name')?.value?.trim() || 'Custom Ship',
                wood: document.querySelector('#tqm-ship-wood')?.value || 'Fenn',
                metal: document.querySelector('#tqm-ship-metal')?.value || 'Darkiron',
                planks: positiveNumber(document.querySelector('#tqm-ship-planks')?.value),
                beams: positiveNumber(document.querySelector('#tqm-ship-beams')?.value),
                nails: positiveNumber(document.querySelector('#tqm-ship-nails')?.value),
                shipwrightFee: positiveNumber(document.querySelector('#tqm-ship-fee')?.value),
                inventory: {
                    ...DEFAULT_STATE.shipBuilder.inventory,
                    ...(state.shipBuilder?.inventory || {})
                },
                manualInventoryOverride:
                    Boolean(state.shipBuilder?.manualInventoryOverride),
                inventoryPanelOpen:
                    Boolean(state.shipBuilder?.inventoryPanelOpen),
                inventoryPanelPosition: {
                    ...DEFAULT_STATE.shipBuilder.inventoryPanelPosition,
                    ...(state.shipBuilder?.inventoryPanelPosition || {})
                }
            };

            saveState();
            renderActiveTab('ship');
        };

        [
            '#tqm-ship-name',
            '#tqm-ship-wood',
            '#tqm-ship-metal',
            '#tqm-ship-planks',
            '#tqm-ship-beams',
            '#tqm-ship-nails',
            '#tqm-ship-fee'
        ].forEach(selector => {
            document.querySelector(selector)?.addEventListener(
                'change',
                saveShipBuilder
            );
        });

        const saveShipInventory = () => {
            state.shipBuilder = {
                ...state.shipBuilder,
                manualInventoryOverride: true,
                inventory: {
                    logs: positiveNumber(document.querySelector('#tqm-have-logs')?.value),
                    ore: positiveNumber(document.querySelector('#tqm-have-ore')?.value),
                    bars: positiveNumber(document.querySelector('#tqm-have-bars')?.value),
                    nails: positiveNumber(document.querySelector('#tqm-have-nails')?.value),
                    planks: positiveNumber(document.querySelector('#tqm-have-planks')?.value),
                    beams: positiveNumber(document.querySelector('#tqm-have-beams')?.value)
                }
            };

            saveState();
            renderActiveTab('ship');
        };

        [
            '#tqm-have-logs',
            '#tqm-have-ore',
            '#tqm-have-bars',
            '#tqm-have-nails',
            '#tqm-have-planks',
            '#tqm-have-beams'
        ].forEach(selector => {
            document.querySelector(selector)?.addEventListener(
                'change',
                saveShipInventory
            );
        });

        document.querySelector('#tqm-clear-ship-inventory')?.addEventListener(
            'click',
            () => {
                state.shipBuilder = {
                    ...state.shipBuilder,
                    manualInventoryOverride: true,
                    inventory: {
                        logs: 0,
                        ore: 0,
                        bars: 0,
                        nails: 0,
                        planks: 0,
                        beams: 0
                    }
                };

                saveState();
                renderActiveTab('ship');
                showToast(
                    'Owned ship materials cleared. Inventory refresh will restore scanned amounts.'
                );
            }
        );

        document.querySelector('#tqm-progress-skill')?.addEventListener(
            'change',
            event => {
                const skill = event.target.value;
                const first = calculateXpRows().find(
                    recipe => recipe.skill === skill
                );

                state.progressPlanner = {
                    ...state.progressPlanner,
                    skill,
                    itemKey: first
                        ? xpRecipeKey(first.skill, first.item)
                        : ''
                };
                saveState();
                renderActiveTab('xp');
            }
        );

        document.querySelector('#tqm-progress-item')?.addEventListener(
            'change',
            event => {
                state.progressPlanner = {
                    ...state.progressPlanner,
                    itemKey: event.target.value
                };
                saveState();
                renderActiveTab('xp');
            }
        );

        document.querySelector('#tqm-progress-target')?.addEventListener(
            'change',
            event => {
                const recipe = selectedProgressRecipe();
                const plan = calculateProgressPlan();
                const currentLevel = Math.max(
                    1,
                    Number(plan?.currentLevel || state.skillLevels[recipe?.skill] || 1)
                );

                state.progressPlanner = {
                    ...state.progressPlanner,
                    targetLevel: Math.max(
                        currentLevel + 1,
                        Math.min(200, Math.floor(Number(event.target.value) || currentLevel + 1))
                    )
                };
                saveState();
                renderActiveTab('xp');
            }
        );

        document.querySelector('#tqm-progress-current-level')?.addEventListener(
            'change',
            event => {
                const recipe = selectedProgressRecipe();
                if (!recipe) return;

                const currentLevel = Math.max(
                    1,
                    Math.min(200, Math.floor(Number(event.target.value) || 1))
                );
                const existing = progressPlannerSessionOverrides[recipe.skill] || {};
                const detectedXp = Math.max(
                    0,
                    Number(state.skillProgress?.[recipe.skill]?.currentXp || 0)
                );
                const currentXp = Math.min(
                    Math.max(0, xpRequiredForLevel(currentLevel) - 1),
                    Math.max(0, Number(existing.currentXp ?? detectedXp) || 0)
                );

                progressPlannerSessionOverrides[recipe.skill] = {
                    ...existing,
                    currentLevel,
                    currentXp
                };
                renderActiveTab('xp');
            }
        );

        document.querySelector('#tqm-progress-current-xp')?.addEventListener(
            'change',
            event => {
                const recipe = selectedProgressRecipe();
                if (!recipe) return;

                const plan = calculateProgressPlan();
                const currentLevel = Math.max(1, Number(plan?.currentLevel || 1));
                const currentXp = Math.max(
                    0,
                    Math.min(
                        Math.max(0, xpRequiredForLevel(currentLevel) - 1),
                        Math.floor(Number(event.target.value) || 0)
                    )
                );

                progressPlannerSessionOverrides[recipe.skill] = {
                    ...(progressPlannerSessionOverrides[recipe.skill] || {}),
                    currentLevel,
                    currentXp
                };
                renderActiveTab('xp');
            }
        );

        document.querySelector('#tqm-progress-use-detected')?.addEventListener(
            'click',
            () => {
                const recipe = selectedProgressRecipe();
                if (!recipe) return;

                delete progressPlannerSessionOverrides[recipe.skill];
                renderActiveTab('xp');
                showToast('Detected level and XP restored.');
            }
        );

        const setSimulatedMasteryTrack = (
            skill,
            track,
            value
        ) => {
            const current = simulatorPointsForSkill(skill);
            const nextValue = Math.max(
                0,
                Math.min(
                    9,
                    Math.floor(Number(value) || 0)
                )
            );

            state.masterySimulator = {
                allocations: {
                    ...(
                        state.masterySimulator?.allocations ||
                        {}
                    ),
                    [skill]: {
                        ...current,
                        [track]: nextValue
                    }
                }
            };

            saveState();
            renderActiveTab('simulator');
        };

        document.querySelectorAll(
            '[data-tqm-simulator-skill][data-tqm-simulator-track]'
        ).forEach(input => {
            input.addEventListener('change', () => {
                setSimulatedMasteryTrack(
                    input.dataset.tqmSimulatorSkill,
                    input.dataset.tqmSimulatorTrack,
                    input.value
                );
            });
        });

        document.querySelectorAll(
            '[data-tqm-step-skill][data-tqm-step-track]'
        ).forEach(button => {
            button.addEventListener('click', () => {
                const skill = button.dataset.tqmStepSkill;
                const track = button.dataset.tqmStepTrack;
                const direction = Number(
                    button.dataset.tqmStepDirection || 0
                );
                const current = simulatorPointsForSkill(skill);

                setSimulatedMasteryTrack(
                    skill,
                    track,
                    Number(current[track] || 0) + direction
                );
            });
        });

        document.querySelectorAll(
            '[data-tqm-reset-mastery-skill]'
        ).forEach(button => {
            button.addEventListener('click', () => {
                const skill =
                    button.dataset.tqmResetMasterySkill;

                state.masterySimulator = {
                    allocations: {
                        ...(
                            state.masterySimulator?.allocations ||
                            {}
                        ),
                        [skill]: {
                            experiencePoints: 0,
                            yieldPoints: 0
                        }
                    }
                };

                saveState();
                renderActiveTab('simulator');
            });
        });


        document.querySelector('.tqm-reset-all-mastery')?.addEventListener('click', () => {
            const allocations = {};
            SIMULATED_MASTERY_SKILLS.forEach(skill => {
                allocations[skill] = {
                    experiencePoints: 0,
                    yieldPoints: 0
                };
            });
            state.masterySimulator = { allocations };
            saveState();
            renderActiveTab('simulator');
        });

document.querySelector('#tqm-read-mastery')?.addEventListener('click', () => {
            const masteryCount = scanMasteryFromPage();
            const levelCount = scanSkillLevelsFromPage();

            if (masteryCount > 0 || levelCount > 0) {
                showToast(
                    `Read ${masteryCount} mastery values and ${levelCount} skill levels.`
                );
                renderActiveTab('mastery');
            } else {
                showToast('No mastery or skill levels found. Open Tidefall’s skill screen first.');
            }
        });

        document.querySelector('#tqm-exclude-locked')?.addEventListener('change', event => {
            state.excludeLockedCrafts = Boolean(event.target.checked);
            saveState();
            showToast(
                state.excludeLockedCrafts
                    ? 'Locked crafts are now excluded.'
                    : 'Locked crafts are now included.'
            );

            /*
             * Re-render Settings so the checkbox and detected-level summary
             * update without switching the user back to Overview.
             */
            renderActiveTab('mastery');
        });

        document.querySelector('#tqm-clear-skill-levels')?.addEventListener(
            'click',
            () => {
                Object.keys(state.skillLevels).forEach(skill => {
                    state.skillLevels[skill] = 0;
                });

                saveState();
                renderActiveTab('mastery');
                showToast('Profession levels reset.');
            }
        );

        document.querySelectorAll('.tqm-skill-level-input').forEach(input => {
            input.addEventListener('change', event => {
                const skill = event.target.dataset.skill;
                if (!skill || !(skill in state.skillLevels)) return;

                const level = Math.max(
                    0,
                    Math.min(
                        200,
                        Math.floor(Number(event.target.value) || 0)
                    )
                );

                state.skillLevels[skill] = level;
                saveState();
                renderActiveTab('mastery');
                showToast(
                    `${skill[0].toUpperCase() + skill.slice(1)} level saved.`
                );
            });
        });

        const updatePreference = (key, value) => {
            state.preferences = {
                ...DEFAULT_STATE.preferences,
                ...(state.preferences || {}),
                [key]: value
            };
            saveState();
            applyQuartermasterPreferences();
        };

        document.querySelector('#tqm-settings-read-exchange')
            ?.addEventListener('click', () => {
                const captured = scanVisibleExchange({
                    includeVendorDetail: true
                });
                const detailMessage = state.vendorDebug?.saved
                    ? ` ${state.vendorDebug.status}.`
                    : '';

                showToast(
                    `Captured ${captured} visible Exchange rows.${detailMessage}`
                );
                renderActiveTab('mastery');
            });

        document.querySelector('#tqm-settings-scan-inventory')
            ?.addEventListener('click', () => {
                if (
                    !document.querySelector('#inv-wh-grid') &&
                    !document.querySelector('#inv-cargo-grid')
                ) {
                    showToast('Open the warehouse or ship cargo before scanning.');
                    return;
                }

                scanGameInventory(true);
                showToast('Inventory scan complete.');
                renderActiveTab('mastery');
            });

        document.querySelector('#tqm-clear-inventory-cache')
            ?.addEventListener('click', () => {
                state.inventoryCache = {
                    ...DEFAULT_STATE.inventoryCache,
                    items: {},
                    warehouseItems: {},
                    cargoItems: {},
                    updatedAt: 0
                };
                state.shipBuilder = {
                    ...state.shipBuilder,
                    manualInventoryOverride: false
                };
                applyCachedInventoryToShipBuilder(true);
                saveState();
                showToast('Inventory cache cleared.');
                renderActiveTab('mastery');
            });

        [
            ['#tqm-pref-auto-inventory', 'autoRefreshInventory'],
            ['#tqm-pref-warehouse', 'includeWarehouseInventory'],
            ['#tqm-pref-ship-inventory', 'includeShipInventory'],
            ['#tqm-pref-raw-materials', 'showRawMaterials'],
            ['#tqm-pref-intermediate-materials', 'showIntermediateMaterials'],
            ['#tqm-pref-ship-progress', 'showShipProgress'],
            ['#tqm-pref-buy-craft', 'showBuyCraftRecommendations'],
            ['#tqm-pref-compact', 'compactMode'],
            ['#tqm-pref-item-inspector', 'itemInspectorEnabled'],
            ['#tqm-pref-price-freshness', 'showPriceFreshness'],
            ['#tqm-pref-pinned-comparison', 'pinnedComparisonEnabled'],
            ['#tqm-pref-craft-capacity', 'showInspectorCraftCapacity'],
            ['#tqm-pref-locked-rows', 'showLockedSkillRows'],
            ['#tqm-pref-source-indicators', 'showCalculationSourceIndicators']
        ].forEach(([selector, key]) => {
            document.querySelector(selector)?.addEventListener(
                'change',
                event => {
                    updatePreference(key, Boolean(event.target.checked));

                    if (
                        key === 'itemInspectorEnabled' &&
                        !Boolean(event.target.checked)
                    ) {
                        itemInspectorPinned = false;
                        itemInspectorCompareItemName = '';
                        hideItemInspector();
                    }

                    renderActiveTab('mastery');
                }
            );
        });

        document.querySelector('#tqm-pref-font-size')
            ?.addEventListener('change', event => {
                updatePreference('fontSize', event.target.value);
                renderActiveTab('mastery');
            });

        document.querySelector('#tqm-pref-theme')
            ?.addEventListener('change', event => {
                updatePreference('theme', event.target.value);
                renderActiveTab('mastery');
            });

        document.querySelector('#tqm-export-settings')
            ?.addEventListener('click', () => {
                downloadQuartermasterFile(
                    `Tidefall_Quartermaster_Settings_${VERSION}.json`,
                    JSON.stringify({
                        app: 'Tidefall Quartermaster',
                        version: VERSION,
                        exportedAt: new Date().toISOString(),
                        state
                    }, null, 2)
                );
                showToast('Quartermaster settings exported.');
            });

        document.querySelector('#tqm-import-settings')
            ?.addEventListener('change', event => {
                const file = event.target.files?.[0];
                if (!file) return;

                const reader = new FileReader();
                reader.onload = () => {
                    try {
                        const parsed = JSON.parse(String(reader.result || '{}'));
                        localStorage.setItem(
                            STORAGE_KEY,
                            JSON.stringify(parsed.state || parsed)
                        );
                        state = loadState();
                        preloadKnownVendorPrices();
                        preloadKnownXpRecipes();
                        saveState();
                        showToast('Quartermaster settings imported.');
                        renderActiveTab('mastery');
                    } catch (error) {
                        console.error('[Tidefall Quartermaster] Import failed:', error);
                        showToast('Import failed. The JSON file is invalid.');
                    }
                };
                reader.readAsText(file);
            });

        document.querySelector('#tqm-download-debug')
            ?.addEventListener('click', () => {
                const status = quartermasterStatusData();
                downloadQuartermasterFile(
                    `Tidefall_Quartermaster_Debug_${VERSION}.json`,
                    JSON.stringify({
                        app: 'Tidefall Quartermaster',
                        version: VERSION,
                        generatedAt: new Date().toISOString(),
                        city: state.currentCity,
                        status,
                        preferences: state.preferences,
                        mastery: state.mastery,
                        skillLevels: state.skillLevels,
                        inventory: {
                            itemCount: status.inventoryItems,
                            updatedAt: state.inventoryCache?.updatedAt || 0,
                            hasRoundedValues: Boolean(
                                state.inventoryCache?.hasRoundedValues
                            )
                        },
                        userAgent: navigator.userAgent
                    }, null, 2)
                );
                showToast('Debug report downloaded.');
            });

        document.querySelector('#tqm-reset-quartermaster')
            ?.addEventListener('click', () => {
                if (!window.confirm(
                    'Reset all Quartermaster settings and cached data?'
                )) return;

                localStorage.removeItem(STORAGE_KEY);
                state = loadState();
                preloadKnownVendorPrices();
                preloadKnownXpRecipes();
                saveState();
                showToast('Quartermaster reset.');
                renderActiveTab('mastery');
            });

        document.querySelector('#tqm-developer-mode')?.addEventListener(
            'change',
            event => {
                state.developerMode = Boolean(event.target.checked);
                saveState();
                syncDeveloperTab();
                syncVendorReadButton();
                syncVendorDetailObserver();

                showToast(
                    state.developerMode
                        ? 'Developer Mode enabled.'
                        : 'Developer Mode disabled.'
                );

                renderActiveTab('mastery');
            }
        );

        document.querySelector('#tqm-tax')?.addEventListener('change', event => {
            state.taxPercent = Math.max(0, Math.min(100, Number(event.target.value) || 0));
            event.target.value = state.taxPercent;
            saveState();
        });

        document.querySelector('#tqm-clear-mastery')?.addEventListener(
            'click',
            () => {
                MASTERY_SKILLS.forEach(skill => {
                    state.mastery[skill] = {
                        experience: 0,
                        yield: 0
                    };
                });

                state.masteryUpdatedAt = 0;
                saveState();
                updateHeaderMasteryDisplay();
                renderActiveTab('mastery');
                showToast('Detected mastery cleared.');
            }
        );

        document.querySelector('#tqm-clear-market')?.addEventListener('click', () => {
            const preservedVendorPrices = {};

            Object.entries(state.prices).forEach(([name, record]) => {
                const vendorPrice = Number(record?.vendorPrice || 0);

                if (!(vendorPrice > 0)) {
                    return;
                }

                preservedVendorPrices[name] = {
                    name,
                    id: record.id ?? null,
                    ask: 0,
                    bid: 0,
                    spread: 0,
                    weeklyVolume: 0,
                    lastSold: 0,
                    vendorPrice,
                    source:
                        String(record.source || '').includes('vendor')
                            ? record.source
                            : 'preserved-vendor',
                    capturedAt: record.capturedAt || Date.now()
                };
            });

            state.prices = preservedVendorPrices;

            /*
             * Restore the built-in log and ammunition vendor values even if
             * the user previously cleared all cached market records.
             */
            preloadKnownVendorPrices();

            saveState();
            showToast(
                'Exchange market data cleared. Vendor prices were preserved.'
            );
            renderActiveTab(
                state.developerMode ? 'captured' : 'mastery'
            );
        });
    }

    function showToast(message) {
        let toast = document.querySelector('#tqm-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'tqm-toast';
            document.body.appendChild(toast);
        }

        toast.textContent = message;
        toast.classList.add('tqm-show');

        clearTimeout(showToast.timer);
        showToast.timer = setTimeout(() => {
            toast.classList.remove('tqm-show');
        }, 2800);
    }


    function loadJournalState() {
        const defaults = {
            text: '',
            left: Math.max(20, window.innerWidth - 410),
            top: 110,
            width: 360,
            height: 280,
            minimized: false,
            open: false
        };

        try {
            const saved = JSON.parse(
                localStorage.getItem(JOURNAL_STORAGE_KEY) || '{}'
            );

            return {
                ...defaults,
                ...saved,
                text: String(saved.text || '').slice(0, JOURNAL_MAX_LENGTH)
            };
        } catch {
            return defaults;
        }
    }

    let journalState = loadJournalState();

    function saveJournalState() {
        localStorage.setItem(
            JOURNAL_STORAGE_KEY,
            JSON.stringify(journalState)
        );
    }

    function clampJournalPosition(panel) {
        const margin = 8;
        const rect = panel.getBoundingClientRect();
        const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
        const maxTop = Math.max(margin, window.innerHeight - 48);

        journalState.left = Math.min(
            Math.max(margin, Number(journalState.left) || margin),
            maxLeft
        );
        journalState.top = Math.min(
            Math.max(margin, Number(journalState.top) || margin),
            maxTop
        );

        panel.style.left = `${journalState.left}px`;
        panel.style.top = `${journalState.top}px`;
    }

    function updateJournalCounter(panel) {
        const textarea = panel.querySelector('#tqm-journal-text');
        const counter = panel.querySelector('#tqm-journal-counter');

        if (textarea && counter) {
            counter.textContent = `${textarea.value.length} / ${JOURNAL_MAX_LENGTH}`;
        }
    }

    function applyJournalState(panel) {
        panel.classList.toggle('tqm-journal-minimized', journalState.minimized);
        panel.classList.toggle('tqm-journal-open', journalState.open);
        panel.style.width = `${Math.max(280, Number(journalState.width) || 360)}px`;
        panel.style.height = journalState.minimized
            ? '44px'
            : `${Math.max(180, Number(journalState.height) || 280)}px`;
        clampJournalPosition(panel);

        const minimizeButton = panel.querySelector('#tqm-journal-minimize');
        if (minimizeButton) {
            minimizeButton.textContent = journalState.minimized ? '□' : '−';
            minimizeButton.title = journalState.minimized ? 'Restore' : 'Minimize';
        }
    }

    function createJournal() {
        let panel = document.getElementById(JOURNAL_ID);
        if (panel) return panel;

        panel = document.createElement('aside');
        panel.id = JOURNAL_ID;
        panel.innerHTML = `
            <div class="tqm-journal-header" id="tqm-journal-drag">
                <div>
                    <span>Captain's Journal</span>
                    <small>Personal notes saved in this browser</small>
                </div>

                <div class="tqm-journal-actions">
                    <button
                        id="tqm-journal-minimize"
                        type="button"
                        aria-label="Minimize journal"
                        title="Minimize"
                    >−</button>
                    <button
                        id="tqm-journal-close"
                        type="button"
                        aria-label="Close journal"
                        title="Close"
                    >×</button>
                </div>
            </div>

            <div class="tqm-journal-body">
                <textarea
                    id="tqm-journal-text"
                    maxlength="${JOURNAL_MAX_LENGTH}"
                    spellcheck="true"
                    placeholder="After crafting finishes, mine mithril, make nails, then craft repair kits..."
                ></textarea>

                <div class="tqm-journal-footer">
                    <span>Autosaved locally</span>
                    <strong id="tqm-journal-counter">0 / ${JOURNAL_MAX_LENGTH}</strong>
                </div>
            </div>
        `;

        document.body.appendChild(panel);

        const textarea = panel.querySelector('#tqm-journal-text');
        textarea.value = journalState.text;
        updateJournalCounter(panel);
        applyJournalState(panel);

        textarea.addEventListener('input', () => {
            journalState.text = textarea.value.slice(0, JOURNAL_MAX_LENGTH);
            updateJournalCounter(panel);
            saveJournalState();
        });

        panel.querySelector('#tqm-journal-minimize').addEventListener('click', event => {
            event.stopPropagation();

            if (!journalState.minimized) {
                const rect = panel.getBoundingClientRect();
                journalState.width = rect.width;
                journalState.height = rect.height;
            }

            journalState.minimized = !journalState.minimized;
            applyJournalState(panel);
            saveJournalState();
        });

        panel.querySelector('#tqm-journal-close').addEventListener('click', event => {
            event.stopPropagation();
            journalState.open = false;
            panel.classList.remove('tqm-journal-open');
            saveJournalState();
        });

        const dragHandle = panel.querySelector('#tqm-journal-drag');
        let dragging = false;
        let offsetX = 0;
        let offsetY = 0;

        dragHandle.addEventListener('pointerdown', event => {
            if (event.target.closest('button')) return;

            const rect = panel.getBoundingClientRect();
            dragging = true;
            offsetX = event.clientX - rect.left;
            offsetY = event.clientY - rect.top;
            dragHandle.setPointerCapture(event.pointerId);
            panel.classList.add('tqm-journal-dragging');
            event.preventDefault();
        });

        dragHandle.addEventListener('pointermove', event => {
            if (!dragging) return;

            journalState.left = event.clientX - offsetX;
            journalState.top = event.clientY - offsetY;
            clampJournalPosition(panel);
        });

        const finishDrag = event => {
            if (!dragging) return;
            dragging = false;
            panel.classList.remove('tqm-journal-dragging');

            if (dragHandle.hasPointerCapture(event.pointerId)) {
                dragHandle.releasePointerCapture(event.pointerId);
            }

            saveJournalState();
        };

        dragHandle.addEventListener('pointerup', finishDrag);
        dragHandle.addEventListener('pointercancel', finishDrag);

        if ('ResizeObserver' in window) {
            let resizeTimer = 0;
            const resizeObserver = new ResizeObserver(() => {
                if (journalState.minimized) return;
                window.clearTimeout(resizeTimer);
                resizeTimer = window.setTimeout(() => {
                    const rect = panel.getBoundingClientRect();
                    journalState.width = Math.round(rect.width);
                    journalState.height = Math.round(rect.height);
                    clampJournalPosition(panel);
                    saveJournalState();
                }, 100);
            });
            resizeObserver.observe(panel);
        }

        window.addEventListener('resize', () => {
            clampJournalPosition(panel);
            saveJournalState();
        });

        return panel;
    }

    function openJournal() {
        const panel = createJournal();
        journalState.open = true;
        applyJournalState(panel);
        saveJournalState();

        if (!journalState.minimized) {
            requestAnimationFrame(() => {
                panel.querySelector('#tqm-journal-text')?.focus();
            });
        }
    }

    function createOverlay() {
        if (document.getElementById(OVERLAY_ID)) return;

        const overlay = document.createElement('div');
        overlay.id = OVERLAY_ID;
        overlay.innerHTML = `
            <div class="tqm-shell">
                <header class="tqm-header">
                    <div>
                        <div class="tqm-brand">Tidefall Quartermaster</div>
                        <div class="tqm-subtitle">Quartermaster's Ledger · v${VERSION}</div>
                    </div>

                    <div class="tqm-header-center">
                        <label class="tqm-header-city">
                            <span>Current City</span>
                            <select
                                id="tqm-header-city-select"
                                title="Detected from Tidefall when Quartermaster opens. Manual changes last until Quartermaster is reopened."
                            >
                                ${Object.keys(CITY_BONUSES).map(city => `
                                    <option value="${escapeHtml(city)}" ${state.currentCity === city ? 'selected' : ''}>
                                        ${escapeHtml(city)}
                                    </option>
                                `).join('')}
                            </select>
                        </label>

                        <div class="tqm-header-mastery">
                            <span>Mastery</span>
                            <strong id="tqm-header-mastery-value">${escapeHtml(masteryDisplayText())}</strong>
                        </div>

                        <div class="tqm-header-updated">
                            <span>Updated</span>
                            <strong id="tqm-header-updated-value">${
                                state.updatedAt
                                    ? new Date(state.updatedAt).toLocaleTimeString([], {
                                        hour: 'numeric',
                                        minute: '2-digit'
                                    })
                                    : 'Not yet'
                            }</strong>
                        </div>
                    </div>

                    <div class="tqm-header-actions">
                        <button id="tqm-open-journal" class="tqm-action tqm-secondary tqm-compact">Journal</button>
                        <div class="tqm-read-exchange-wrap">
                            <button id="tqm-scan-now" class="tqm-action tqm-compact">Read Exchange</button>
                            <small>Exchange market table must be open.</small>
                        </div>
                        <button id="tqm-close" class="tqm-close" title="Close" aria-label="Close">×</button>
                    </div>
                </header>

                <nav class="tqm-tabs">
                    <button data-tqm-tab="overview" class="tqm-active">Overview</button>
                    <button data-tqm-tab="gathering">Logging / Mining</button>
                    <button data-tqm-tab="fishing">Fishing</button>
                    <button data-tqm-tab="carpentry">Carpentry</button>
                    <button data-tqm-tab="smelting">Smelting</button>
                    <button data-tqm-tab="smithing">Smithing</button>
                    <button data-tqm-tab="cooking">Cooking</button>
                    <button data-tqm-tab="crafting">Crafting</button>
                    <button data-tqm-tab="xp">XP Planner</button>
                    <button data-tqm-tab="planner">Queue Planner</button>
                    <button data-tqm-tab="simulator">Mastery Simulator</button>
                    <button data-tqm-tab="ship">Ship Builder</button>
                    <button data-tqm-tab="history">Net Worth</button>
                    ${state.developerMode
                        ? '<button data-tqm-tab="captured">Captured Data</button>'
                        : ''}
                    <button data-tqm-tab="mastery">Settings</button>
                </nav>

                <main id="tqm-content"></main>
            </div>
        `;

        document.body.appendChild(overlay);
        applyQuartermasterPreferences();

        overlay.querySelector('#tqm-close').addEventListener('click', closeOverlay);
        overlay.querySelector('#tqm-open-journal').addEventListener('click', openJournal);
        overlay.addEventListener('click', event => {
            if (event.target === overlay) closeOverlay();
        });

        overlay.querySelectorAll('[data-tqm-tab]').forEach(button => {
            button.addEventListener('click', () => renderActiveTab(button.dataset.tqmTab));
        });

        overlay.querySelector('#tqm-header-city-select').addEventListener('change', event => {
            state.currentCity = event.target.value;
            state.manualCityOverride = true;

            showToast(
                `Using ${state.currentCity} until Quartermaster is reopened.`
            );

            renderActiveTab(
                overlay.querySelector('[data-tqm-tab].tqm-active')?.dataset.tqmTab || 'overview'
            );
        });

        overlay.querySelector('#tqm-scan-now').addEventListener('click', () => {
            const activeTab =
                overlay.querySelector('[data-tqm-tab].tqm-active')
                    ?.dataset.tqmTab ||
                'overview';

            /*
             * Read both the summary table and the currently open item detail.
             * The previous test build explicitly disabled detail scanning here,
             * so order-book quantity could never be saved from this button.
             */
            const captured = scanVisibleExchange({
                includeVendorDetail: true
            });
            const detailMessage = state.vendorDebug?.saved
                ? ` ${state.vendorDebug.status}.`
                : '';

            showToast(
                `Captured ${captured} visible Exchange rows.${detailMessage}`
            );
            renderActiveTab(activeTab);
        });

        updateHeaderMasteryDisplay();
        renderActiveTab('overview');
    }

    function openOverlay() {
        progressPlannerSessionOverrides = {};
        const detectedCity = detectCurrentCityFromPage();

        if (detectedCity) {
            state.currentCity = detectedCity;
        }

        state.manualCityOverride = false;
        saveState();

        scanMasteryFromPage();
        scanSkillLevelsFromPage();
        createOverlay();
        scanVisibleExchange();

        const overlay = document.getElementById(OVERLAY_ID);
        const citySelect = overlay.querySelector('#tqm-header-city-select');

        if (citySelect) {
            citySelect.value = state.currentCity;
        }

        overlay.classList.add('tqm-open');
        document.documentElement.classList.add('tqm-lock-scroll');

        renderActiveTab(
            overlay.querySelector('[data-tqm-tab].tqm-active')?.dataset.tqmTab ||
            document.querySelector('[data-tqm-tab].tqm-active')?.dataset.tqmTab ||
            'overview'
        );

        /*
         * The content panel retains its scroll position while the overlay is
         * hidden. Always reopen Quartermaster at the top of the active tab.
         */
        requestAnimationFrame(() => {
            const content = overlay.querySelector('#tqm-content');

            if (content) {
                content.scrollTop = 0;
                content.scrollLeft = 0;
            }

            overlay.scrollTop = 0;
            overlay.scrollLeft = 0;
        });
    }

    function closeOverlay() {
        document.getElementById(OVERLAY_ID)?.classList.remove('tqm-open');
        document.documentElement.classList.remove('tqm-lock-scroll');
    }

    function loadButtonPosition() {
        try {
            const position = JSON.parse(
                localStorage.getItem(BUTTON_POSITION_KEY) || 'null'
            );

            if (
                position &&
                Number.isFinite(position.left) &&
                Number.isFinite(position.top)
            ) {
                return position;
            }
        } catch {
            // Ignore invalid saved position.
        }

        return null;
    }

    function saveButtonPosition(left, top) {
        localStorage.setItem(
            BUTTON_POSITION_KEY,
            JSON.stringify({ left, top })
        );
    }

    function clampButtonPosition(button, left, top) {
        const rect = button.getBoundingClientRect();
        const maxLeft = Math.max(0, window.innerWidth - rect.width);
        const maxTop = Math.max(0, window.innerHeight - rect.height);

        return {
            left: Math.max(0, Math.min(maxLeft, left)),
            top: Math.max(0, Math.min(maxTop, top))
        };
    }

    function makeQuartermasterButtonDraggable(button) {
        let dragStarted = false;
        let moved = false;
        let startX = 0;
        let startY = 0;
        let startLeft = 0;
        let startTop = 0;

        button.addEventListener('pointerdown', event => {
            if (event.button !== 0) return;

            const rect = button.getBoundingClientRect();

            dragStarted = true;
            moved = false;
            startX = event.clientX;
            startY = event.clientY;
            startLeft = rect.left;
            startTop = rect.top;

            button.setPointerCapture(event.pointerId);
        });

        button.addEventListener('pointermove', event => {
            if (!dragStarted) return;

            const deltaX = event.clientX - startX;
            const deltaY = event.clientY - startY;

            if (!moved && Math.hypot(deltaX, deltaY) < 4) {
                return;
            }

            moved = true;

            button.classList.remove('tqm-header-button');
            button.classList.add('tqm-floating-button', 'tqm-positioned-button');

            const position = clampButtonPosition(
                button,
                startLeft + deltaX,
                startTop + deltaY
            );

            button.style.left = `${position.left}px`;
            button.style.top = `${position.top}px`;
            button.style.transform = 'none';
        });

        button.addEventListener('pointerup', event => {
            if (!dragStarted) return;

            dragStarted = false;

            if (moved) {
                const rect = button.getBoundingClientRect();
                saveButtonPosition(rect.left, rect.top);

                event.preventDefault();
                event.stopPropagation();

                button.dataset.tqmDragged = 'true';

                setTimeout(() => {
                    delete button.dataset.tqmDragged;
                }, 0);
            }
        });

        button.addEventListener('click', event => {
            if (button.dataset.tqmDragged === 'true') {
                event.preventDefault();
                event.stopImmediatePropagation();
            }
        }, true);

        window.addEventListener('resize', () => {
            if (!button.classList.contains('tqm-positioned-button')) return;

            const rect = button.getBoundingClientRect();
            const clamped = clampButtonPosition(button, rect.left, rect.top);

            button.style.left = `${clamped.left}px`;
            button.style.top = `${clamped.top}px`;
            saveButtonPosition(clamped.left, clamped.top);
            positionVendorButton();
        });
    }

    function positionVendorButton() {
        const quartermasterButton = document.getElementById(BUTTON_ID);
        const vendorButton = document.getElementById(VENDOR_BUTTON_ID);

        if (!quartermasterButton || !vendorButton) return;

        const rect = quartermasterButton.getBoundingClientRect();
        const left = Math.min(
            window.innerWidth - vendorButton.offsetWidth - 8,
            rect.right + 8
        );
        const top = Math.max(
            8,
            Math.min(
                window.innerHeight - vendorButton.offsetHeight - 8,
                rect.top
            )
        );

        vendorButton.style.left = `${left}px`;
        vendorButton.style.top = `${top}px`;
    }

    function syncVendorReadButton() {
        const existing = document.getElementById(VENDOR_BUTTON_ID);

        if (!state.developerMode) {
            existing?.remove();
            return;
        }

        createVendorReadButton();
        positionVendorButton();
    }

    function createVendorReadButton() {
        if (!state.developerMode) return;

        if (document.getElementById(VENDOR_BUTTON_ID)) {
            positionVendorButton();
            return;
        }

        const button = document.createElement('button');
        button.id = VENDOR_BUTTON_ID;
        button.type = 'button';
        button.textContent = 'Read Vendor';
        button.title =
            'Capture the vendor price from the currently open Exchange item';

        button.addEventListener('click', () => {
            const captured = scanOpenItemDetail();
            saveState();

            if (captured && state.vendorDebug.saved) {
                showToast(
                    `${state.vendorDebug.itemName}: vendor price ${
                        formatGold(state.vendorDebug.parsedPrice)
                    } saved.`
                );
            } else {
                showToast(
                    state.vendorDebug.status ||
                    'Open an Exchange item detail first.'
                );
            }

            const overlay = document.getElementById(OVERLAY_ID);
            const activeTab = overlay
                ?.querySelector('[data-tqm-tab].tqm-active')
                ?.dataset.tqmTab;

            if (
                overlay?.classList.contains('tqm-open') &&
                activeTab === 'captured'
            ) {
                renderActiveTab('captured');
            }
        });

        document.body.appendChild(button);
        requestAnimationFrame(positionVendorButton);
    }

    function createHeaderButton() {
        if (document.getElementById(BUTTON_ID)) return;

        const button = document.createElement('button');
        button.id = BUTTON_ID;
        button.type = 'button';
        button.textContent = 'Quartermaster';
        button.title = 'Open Quartermaster Ledger';
        button.classList.add('tqm-floating-button');

        button.addEventListener('click', event => {
            if (button.dataset.tqmDragged === 'true') {
                return;
            }

            openOverlay();
        });

        /*
         * Always attach to body. Tidefall replaces portions of its header
         * during navigation, which can remove injected header children.
         */
        document.body.appendChild(button);

        const saved = loadButtonPosition();

        requestAnimationFrame(() => {
            if (saved) {
                const position = clampButtonPosition(
                    button,
                    saved.left,
                    saved.top
                );

                button.style.left = `${position.left}px`;
                button.style.top = `${position.top}px`;
            } else {
                button.style.left = '158px';
                button.style.top = '10px';
            }

            button.style.transform = 'none';
            button.classList.add('tqm-positioned-button');
        });

        makeQuartermasterButtonDraggable(button);
        syncVendorReadButton();
    }

    const style = document.createElement('style');
    style.textContent = `
        html.tqm-lock-scroll,
        html.tqm-lock-scroll body {
            overflow: hidden !important;
        }

        #${BUTTON_ID} {
            position: fixed !important;
            display: block !important;
            visibility: visible !important;
            opacity: 1 !important;
            z-index: 9999999 !important;
            padding: 7px 12px;
            color: var(--gold, #c5a059);
            background: rgba(10, 12, 15, .92);
            border: 1px solid rgba(197, 160, 89, .62);
            border-radius: 5px;
            font-family: var(--font-body, "Gothic A1", sans-serif);
            font-size: 12px;
            font-weight: 800;
            letter-spacing: .06em;
            text-transform: uppercase;
            cursor: grab;
            touch-action: none;
            user-select: none;
            box-shadow: 0 3px 12px rgba(0, 0, 0, .45);
        }

        #${BUTTON_ID}:active {
            cursor: grabbing;
        }

        #${BUTTON_ID}:hover {
            background: rgba(197, 160, 89, .16);
            border-color: rgba(220, 180, 100, .95);
        }

        #${VENDOR_BUTTON_ID} {
            position: fixed !important;
            z-index: 9999999 !important;
            padding: 7px 12px;
            color: #d8c89f;
            background: rgba(10, 12, 15, .92);
            border: 1px solid rgba(197, 160, 89, .42);
            border-radius: 5px;
            font-family: var(--font-body, "Gothic A1", sans-serif);
            font-size: 12px;
            font-weight: 800;
            letter-spacing: .06em;
            text-transform: uppercase;
            cursor: pointer;
            box-shadow: 0 3px 12px rgba(0, 0, 0, .45);
        }

        #${VENDOR_BUTTON_ID}:hover {
            color: #f0c45c;
            background: rgba(197, 160, 89, .16);
            border-color: rgba(220, 180, 100, .95);
        }

        #${BUTTON_ID}.tqm-header-button {
            position: absolute;
            left: 158px;
            top: 50%;
            transform: translateY(-50%);
        }

        #${BUTTON_ID}.tqm-floating-button {
            position: fixed;
            top: 10px;
            left: 158px;
        }

        #${BUTTON_ID}.tqm-positioned-button {
            position: fixed !important;
            margin: 0 !important;
        }

        #${OVERLAY_ID} {
            position: fixed;
            inset: 0;
            z-index: 10000000;
            display: none;
            padding: 14px;
            background:
                radial-gradient(circle at top, rgba(72, 53, 27, .30), transparent 38%),
                rgba(4, 6, 8, .97);
            color: #e8e0d0;
            font-family: var(--font-body, "Gothic A1", sans-serif);
        }

        #${OVERLAY_ID}.tqm-open {
            display: block;
        }

        .tqm-shell {
            height: 100%;
            display: grid;
            grid-template-rows: auto auto 1fr;
            overflow: hidden;
            background: linear-gradient(180deg, rgba(27, 29, 30, .99), rgba(10, 12, 15, .99));
            border: 1px solid rgba(197, 160, 89, .72);
            border-radius: 8px;
            box-shadow: 0 14px 50px rgba(0, 0, 0, .72);
        }

        .tqm-setup-status {
            display: grid;
            gap: 12px;
            margin-bottom: 14px;
            padding: 15px;
            border: 1px solid rgba(197, 160, 89, .28);
            border-radius: 7px;
            background: rgba(10, 12, 14, .40);
        }

        .tqm-setup-complete {
            border-color: rgba(130, 210, 105, .30);
            background: rgba(130, 210, 105, .05);
        }

        .tqm-setup-needed {
            border-color: rgba(240, 196, 92, .34);
            background: rgba(240, 196, 92, .05);
        }

        .tqm-setup-status__header span {
            display: block;
            color: rgba(232, 224, 208, .48);
            font-size: 10px;
            font-weight: 800;
            letter-spacing: .07em;
            text-transform: uppercase;
        }

        .tqm-setup-status__header strong {
            display: block;
            margin-top: 4px;
            color: #f0c45c;
            font-size: 17px;
        }

        .tqm-setup-status__items {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 10px;
        }

        .tqm-setup-item {
            display: grid;
            gap: 4px;
            padding: 11px 12px;
            border: 1px solid rgba(255, 255, 255, .07);
            border-radius: 6px;
            background: rgba(0, 0, 0, .18);
        }

        .tqm-setup-item strong {
            font-size: 12px;
        }

        .tqm-setup-item span {
            color: rgba(232, 224, 208, .58);
            font-size: 11px;
            line-height: 1.45;
        }

        .tqm-setup-item--ready strong {
            color: #aee67a;
        }

        .tqm-setup-item--needed strong {
            color: #f0c45c;
        }

        .tqm-requirement-note {
            margin-top: 8px;
        }

        .tqm-read-exchange-wrap {
            display: grid;
            justify-items: end;
            gap: 4px;
        }

        .tqm-read-exchange-wrap small {
            color: rgba(232, 224, 208, .48);
            font-size: 10px;
            white-space: nowrap;
        }

        .tqm-dashboard-hero {
            margin-bottom: 14px;
            padding: 22px;
            border: 1px solid rgba(197, 160, 89, .28);
            border-radius: 7px;
            background:
                linear-gradient(135deg, rgba(197, 160, 89, .10), rgba(10, 12, 14, .25));
        }

        .tqm-dashboard-hero h2 {
            margin: 6px 0;
            color: #f0c45c;
            font-family: var(--font-heading, Georgia, serif);
            font-size: 25px;
        }

        .tqm-dashboard-hero p {
            margin: 0;
            color: rgba(232, 224, 208, .62);
        }

        .tqm-dashboard-metrics {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 12px;
            margin-bottom: 14px;
        }

        .tqm-metric-card {
            padding: 15px;
            border: 1px solid rgba(197, 160, 89, .18);
            border-radius: 6px;
            background: rgba(0, 0, 0, .18);
        }

        .tqm-metric-card > span {
            display: block;
            color: rgba(232, 224, 208, .48);
            font-size: 10px;
            font-weight: 800;
            letter-spacing: .07em;
            text-transform: uppercase;
        }

        .tqm-metric-card > strong {
            display: block;
            margin-top: 7px;
            color: #f2eee4;
            font-size: 19px;
        }

        .tqm-metric-card > small {
            display: block;
            margin-top: 4px;
            color: rgba(232, 224, 208, .50);
        }

        .tqm-state-positive {
            border-color: rgba(130, 210, 105, .30) !important;
            background: rgba(130, 210, 105, .055) !important;
        }

        .tqm-state-positive > strong,
        .tqm-state-positive strong {
            color: #aee67a !important;
        }

        .tqm-state-warning {
            border-color: rgba(240, 196, 92, .30) !important;
            background: rgba(240, 196, 92, .055) !important;
        }

        .tqm-state-warning > strong,
        .tqm-state-warning strong {
            color: #f0c45c !important;
        }

        .tqm-state-negative {
            border-color: rgba(232, 98, 88, .34) !important;
            background: rgba(232, 98, 88, .06) !important;
        }

        .tqm-state-negative > strong,
        .tqm-state-negative strong {
            color: #ef7c73 !important;
        }

        .tqm-state-muted {
            opacity: .65;
        }

        .tqm-networth-range {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            margin-bottom: 14px;
        }

        .tqm-networth-range-options {
            display: flex;
            gap: 8px;
        }

        .tqm-networth-range button {
            padding: 6px 14px;
            background: rgba(0, 0, 0, .18);
            border: 1px solid rgba(197, 160, 89, .22);
            border-radius: 5px;
            color: rgba(232, 224, 208, .72);
            font-size: 12px;
            font-weight: 700;
            letter-spacing: .04em;
            cursor: pointer;
        }

        .tqm-networth-range button:hover {
            border-color: rgba(197, 160, 89, .5);
            color: #f2eee4;
        }

        .tqm-networth-range button.tqm-active {
            background: rgba(197, 160, 89, .16);
            border-color: rgba(197, 160, 89, .6);
            color: var(--gold, #c5a059);
        }

        .tqm-networth-chart {
            position: relative;
            padding: 12px;
            background: rgba(0, 0, 0, .18);
            border: 1px solid rgba(197, 160, 89, .18);
            border-radius: 6px;
        }

        .tqm-networth-chart svg {
            display: block;
            width: 100%;
            height: 200px;
        }

        .tqm-networth-area {
            fill: rgba(197, 160, 89, .14);
            stroke: none;
        }

        .tqm-networth-line {
            fill: none;
            stroke: var(--gold, #c5a059);
            stroke-width: 2;
            vector-effect: non-scaling-stroke;
        }

        .tqm-networth-chart-scale {
            display: flex;
            justify-content: space-between;
            margin-top: 8px;
            color: rgba(232, 224, 208, .5);
            font-size: 11px;
        }

        .tqm-ship-heading-actions {
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .tqm-floating-inventory {
            position: fixed;
            z-index: 2147483646;
            width: min(390px, calc(100vw - 24px));
            overflow: hidden;
            color: #f2eee4;
            background: #17191c;
            border: 1px solid rgba(197, 160, 89, .42);
            border-radius: 8px;
            box-shadow:
                0 18px 55px rgba(0, 0, 0, .56),
                inset 0 1px 0 rgba(255, 255, 255, .025);
        }

        .tqm-floating-inventory-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 14px;
            padding: 13px 15px;
            background: #202226;
            border-bottom: 1px solid rgba(197, 160, 89, .25);
            cursor: move;
            user-select: none;
            touch-action: none;
        }

        .tqm-floating-inventory-header > div {
            display: grid;
            gap: 2px;
        }

        .tqm-floating-inventory-header span {
            color: rgba(232, 224, 208, .48);
            font-size: 9px;
            font-weight: 800;
            letter-spacing: .09em;
            text-transform: uppercase;
        }

        .tqm-floating-inventory-header strong {
            color: #d6ad61;
            font-family: var(--font-heading, Georgia, serif);
            font-size: 18px;
            letter-spacing: .06em;
            text-transform: uppercase;
        }

        .tqm-floating-inventory-header-actions {
            display: flex;
            align-items: center;
            gap: 7px;
        }

        .tqm-floating-inventory-header button {
            width: 32px;
            height: 32px;
            padding: 0;
            color: rgba(242, 238, 228, .75);
            background: transparent;
            border: 1px solid rgba(255, 255, 255, .12);
            border-radius: 50%;
            font-size: 19px;
            line-height: 1;
            cursor: pointer;
        }

        .tqm-floating-inventory-header button:hover {
            color: #fff;
            border-color: rgba(197, 160, 89, .48);
            background: rgba(197, 160, 89, .08);
        }

        .tqm-floating-inventory-body {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 12px;
            padding: 14px;
        }

        .tqm-floating-inventory-body section {
            display: grid;
            gap: 8px;
            padding: 11px;
            background: rgba(7, 9, 11, .34);
            border: 1px solid rgba(197, 160, 89, .13);
            border-radius: 6px;
        }

        .tqm-floating-inventory-body h3 {
            margin: 0 0 2px;
            color: #cda85f;
            font-family: var(--font-heading, Georgia, serif);
            font-size: 13px;
            letter-spacing: .07em;
            text-transform: uppercase;
        }

        .tqm-floating-inventory-body label {
            display: grid;
            grid-template-columns: minmax(0, 1fr) 92px;
            align-items: center;
            gap: 8px;
        }

        .tqm-floating-inventory-body label span {
            color: rgba(242, 238, 228, .78);
            font-size: 12px;
        }

        .tqm-floating-inventory-body input {
            width: 100%;
            min-width: 0;
            box-sizing: border-box;
            padding: 7px 8px;
            color: #f2eee4;
            text-align: right;
            background: #101215;
            border: 1px solid rgba(197, 160, 89, .25);
            border-radius: 4px;
            font-variant-numeric: tabular-nums;
        }

        .tqm-floating-inventory-footer {
            display: grid;
            gap: 3px;
            padding: 9px 14px 11px;
            color: rgba(232, 224, 208, .42);
            border-top: 1px solid rgba(255, 255, 255, .055);
            font-size: 10px;
            text-align: center;
        }

        .tqm-floating-inventory-footer-title {
            color: #cda85f;
            font-size: 10px;
            font-weight: 800;
            letter-spacing: .08em;
            text-transform: uppercase;
        }

        .tqm-inventory-rounded-warning {
            margin-top: 4px;
            padding: 8px 9px;
            color: #f0c45c;
            background: rgba(240, 196, 92, .07);
            border: 1px solid rgba(240, 196, 92, .20);
            border-radius: 5px;
            font-size: 10px;
            line-height: 1.4;
        }

        .tqm-floating-inventory-footer strong {
            color: rgba(232, 224, 208, .68);
            font-size: 10px;
            font-weight: 700;
        }


        #${JOURNAL_ID} {
            position: fixed;
            display: none;
            flex-direction: column;
            min-width: 280px;
            min-height: 180px;
            max-width: calc(100vw - 16px);
            max-height: calc(100vh - 16px);
            z-index: 2147483645;
            overflow: hidden;
            resize: both;
            border: 1px solid rgba(186, 145, 69, 0.62);
            border-radius: 10px;
            background:
                linear-gradient(180deg, rgba(29, 36, 44, 0.98), rgba(15, 21, 27, 0.98));
            color: #f1eadc;
            box-shadow: 0 16px 45px rgba(0, 0, 0, 0.52);
            font-family: inherit;
        }

        #${JOURNAL_ID}.tqm-journal-open {
            display: flex;
        }

        #${JOURNAL_ID}.tqm-journal-minimized {
            min-height: 44px;
            max-height: 44px;
            resize: none;
        }

        #${JOURNAL_ID}.tqm-journal-dragging {
            user-select: none;
        }

        .tqm-journal-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex: 0 0 44px;
            gap: 12px;
            padding: 0 8px 0 13px;
            border-bottom: 1px solid rgba(186, 145, 69, 0.25);
            background: rgba(8, 13, 18, 0.78);
            cursor: move;
            touch-action: none;
        }

        .tqm-journal-header > div:first-child {
            min-width: 0;
            display: flex;
            flex-direction: column;
            line-height: 1.15;
        }

        .tqm-journal-header span {
            color: #e2bd72;
            font-size: 14px;
            font-weight: 800;
            letter-spacing: 0.02em;
        }

        .tqm-journal-header small {
            color: #9ca9b3;
            font-size: 10px;
            font-weight: 600;
        }

        .tqm-journal-actions {
            display: flex;
            gap: 4px;
            flex: 0 0 auto;
        }

        .tqm-journal-actions button {
            width: 29px;
            height: 29px;
            padding: 0;
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 6px;
            background: rgba(255, 255, 255, 0.05);
            color: #f2eadc;
            cursor: pointer;
            font-size: 17px;
            line-height: 1;
        }

        .tqm-journal-actions button:hover {
            border-color: rgba(226, 189, 114, 0.65);
            background: rgba(226, 189, 114, 0.12);
        }

        .tqm-journal-body {
            display: flex;
            flex: 1 1 auto;
            min-height: 0;
            flex-direction: column;
            padding: 10px;
        }

        .tqm-journal-minimized .tqm-journal-body {
            display: none;
        }

        #tqm-journal-text {
            box-sizing: border-box;
            width: 100%;
            min-height: 0;
            flex: 1 1 auto;
            resize: none;
            padding: 11px 12px;
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 7px;
            outline: none;
            background: rgba(3, 8, 12, 0.62);
            color: #f4efe6;
            font: inherit;
            font-size: 14px;
            line-height: 1.45;
        }

        #tqm-journal-text:focus {
            border-color: rgba(226, 189, 114, 0.68);
            box-shadow: 0 0 0 2px rgba(226, 189, 114, 0.09);
        }

        #tqm-journal-text::placeholder {
            color: #74818c;
        }

        .tqm-journal-footer {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 7px 2px 0;
            color: #8f9aa3;
            font-size: 10px;
            font-weight: 700;
        }

        .tqm-journal-footer strong {
            color: #c9b17c;
            font-variant-numeric: tabular-nums;
        }


        @media (max-width: 520px) {
            .tqm-ship-heading-actions {
                align-items: stretch;
                flex-direction: column-reverse;
            }

            .tqm-floating-inventory-body {
                grid-template-columns: 1fr;
            }
        }

        .tqm-ship-builder-grid {
            display: grid;
            grid-template-columns: 1.05fr 1fr 1fr;
            gap: 14px;
            align-items: start;
            margin-bottom: 14px;
        }

        .tqm-ship-builder-grid > .tqm-card,
        .tqm-ship-builder-grid > .tqm-ship-materials-layout > .tqm-card {
            margin: 0;
        }

        .tqm-ship-builder-grid > .tqm-ship-materials-layout {
            display: contents;
        }

        .tqm-ship-builder-grid .tqm-ship-form {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .tqm-ship-builder-grid .tqm-ship-preset-field {
            grid-column: 1 / -1;
        }

        @media (max-width: 1200px) {
            .tqm-dashboard-metrics {
                grid-template-columns: repeat(2, minmax(0, 1fr));
            }

            .tqm-ship-builder-grid {
                grid-template-columns: 1fr;
            }

            .tqm-ship-builder-grid > .tqm-ship-materials-layout {
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
            }
        }

        @media (max-width: 720px) {
            .tqm-dashboard-metrics,
            .tqm-ship-builder-grid > .tqm-ship-materials-layout {
                grid-template-columns: 1fr;
            }
        }

        .tqm-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 20px;
            padding: 16px 20px;
            border-bottom: 1px solid rgba(197, 160, 89, .26);
            background: linear-gradient(180deg, rgba(28, 24, 18, .98), rgba(9, 10, 13, .98));
        }

        .tqm-brand {
            color: var(--gold, #c5a059);
            font-family: var(--font-heading, Georgia, serif);
            font-size: 24px;
            font-weight: 800;
            letter-spacing: .10em;
            text-transform: uppercase;
        }

        .tqm-subtitle {
            margin-top: 3px;
            color: rgba(232, 224, 208, .56);
            font-size: 12px;
            letter-spacing: .08em;
            text-transform: uppercase;
        }

        .tqm-header-center {
            flex: 1;
            display: flex;
            justify-content: center;
        }

        .tqm-header-city {
            display: flex;
            align-items: center;
            gap: 10px;
            color: rgba(232, 224, 208, .58);
            font-size: 11px;
            font-weight: 800;
            letter-spacing: .08em;
            text-transform: uppercase;
        }

        .tqm-header-city select {
            min-width: 170px;
            padding: 8px 11px;
            color: #ffffff;
            background: #181a1f;
            border: 1px solid #8d6a2f;
            border-radius: 5px;
            font: inherit;
            color-scheme: dark;
            cursor: pointer;
        }

        .tqm-header-city select:hover,
        .tqm-header-city select:focus {
            outline: none;
            color: #ffffff;
            background: #181a1f;
            border-color: #c5a059;
        }

        .tqm-header-city select option {
            color: #ffffff;
            background: #181a1f;
        }

        .tqm-header-center {
            gap: 24px;
            align-items: center;
        }

        .tqm-header-mastery {
            display: flex;
            align-items: center;
            gap: 10px;
            min-width: 0;
            color: rgba(232, 224, 208, .58);
            font-size: 11px;
            font-weight: 800;
            letter-spacing: .08em;
            text-transform: uppercase;
        }

        .tqm-header-mastery strong {
            max-width: 520px;
            overflow: hidden;
            text-overflow: ellipsis;
            color: #aee67a;
            white-space: nowrap;
            letter-spacing: .02em;
            text-transform: none;
        }

        .tqm-header-updated {
            display: flex;
            align-items: center;
            gap: 8px;
            color: rgba(232, 224, 208, .58);
            font-size: 11px;
            font-weight: 800;
            letter-spacing: .08em;
            text-transform: uppercase;
            white-space: nowrap;
        }

        .tqm-header-updated strong {
            color: #e7d8b5;
            letter-spacing: .02em;
            text-transform: none;
        }

        .tqm-mastery-simulator-toolbar {
            display: flex;
            align-items: center;
            justify-content: flex-end;
            gap: 12px;
            padding: 8px 10px;
            background: rgba(197, 160, 89, .06);
            border: 1px solid rgba(197, 160, 89, .18);
            border-radius: 6px;
            white-space: nowrap;
        }

        .tqm-mastery-simulator-toolbar span {
            color: rgba(232, 224, 208, .62);
            font-size: 11px;
        }

        .tqm-mastery-simulator-toolbar span strong {
            color: #f0c45c;
            font-size: 16px;
        }

        .tqm-mastery-skill-grid {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 10px;
            margin-top: 14px;
        }

        .tqm-mastery-skill-card {
            display: grid;
            gap: 9px;
            padding: 11px 12px;
            background: rgba(7, 9, 11, .32);
            border: 1px solid rgba(197, 160, 89, .14);
            border-radius: 7px;
        }

        .tqm-mastery-skill-card-heading {
            display: flex;
            align-items: start;
            justify-content: space-between;
            gap: 10px;
        }

        .tqm-mastery-skill-card-heading h3 {
            margin: 0;
            color: #d6ad61;
            font-family: var(--font-heading, Georgia, serif);
            font-size: 15px;
            letter-spacing: .05em;
            text-transform: uppercase;
        }

        .tqm-mastery-skill-card-heading small {
            display: block;
            margin-top: 2px;
            color: rgba(232, 224, 208, .44);
            font-size: 9px;
        }

        .tqm-mastery-skill-card-heading button {
            padding: 4px 7px;
            color: rgba(232, 224, 208, .58);
            background: transparent;
            border: 1px solid rgba(197, 160, 89, .18);
            border-radius: 4px;
            font-size: 8px;
            font-weight: 700;
            letter-spacing: .05em;
            text-transform: uppercase;
            cursor: pointer;
        }

        .tqm-mastery-stepper-row {
            display: grid;
            grid-template-columns: 42px auto minmax(62px, 1fr);
            align-items: center;
            gap: 10px;
        }

        .tqm-mastery-stepper-row > span {
            color: rgba(232, 224, 208, .58);
            font-size: 10px;
            font-weight: 800;
            letter-spacing: .06em;
            text-transform: uppercase;
        }

        .tqm-mastery-stepper {
            display: grid;
            grid-template-columns: 30px 42px 30px;
            align-items: center;
            overflow: hidden;
            border: 1px solid rgba(197, 160, 89, .24);
            border-radius: 5px;
            background: #101215;
        }

        .tqm-mastery-stepper button {
            width: 30px;
            height: 30px;
            padding: 0;
            color: #e8e0d0;
            background: transparent;
            border: 0;
            cursor: pointer;
            font-size: 16px;
            line-height: 1;
        }

        .tqm-mastery-stepper button:hover {
            color: #fff;
            background: rgba(197, 160, 89, .10);
        }

        .tqm-mastery-stepper input {
            width: 42px;
            height: 30px;
            padding: 0;
            color: #f0c45c;
            text-align: center;
            background: rgba(255, 255, 255, .025);
            border: 0;
            border-left: 1px solid rgba(197, 160, 89, .18);
            border-right: 1px solid rgba(197, 160, 89, .18);
            font-size: 12px;
            font-weight: 800;
            appearance: textfield;
            -moz-appearance: textfield;
        }

        .tqm-mastery-stepper input::-webkit-inner-spin-button,
        .tqm-mastery-stepper input::-webkit-outer-spin-button {
            margin: 0;
            appearance: none;
            -webkit-appearance: none;
        }

        .tqm-mastery-stepper-row > strong {
            color: #f0c45c;
            font-size: 11px;
            text-align: right;
            white-space: nowrap;
        }

        .tqm-mastery-reset-icon {
            width: 28px;
            height: 28px;
            padding: 0 !important;
            font-size: 15px !important;
            line-height: 1;
        }

        .tqm-reset-all-mastery {
            margin: 0;
            padding: 6px 9px;
            background: transparent;
            border: 1px solid rgba(197,160,89,.28);
            color: #e8e0d0;
            border-radius: 5px;
            cursor: pointer;
            font-size: 9px;
            font-weight: 700;
            text-transform: uppercase;
        }

        @media (max-width: 1500px) {
            .tqm-mastery-skill-grid {
                grid-template-columns: repeat(3, minmax(0, 1fr));
            }
        }

        @media (max-width: 1100px) {
            .tqm-mastery-skill-grid {
                grid-template-columns: repeat(2, minmax(0, 1fr));
            }
        }

        @media (max-width: 700px) {
            .tqm-mastery-skill-grid {
                grid-template-columns: 1fr;
            }
        }

        #tqm-content .tqm-captured-table-wrap {
            width: 100%;
            height: calc(100vh - 300px);
            max-height: calc(100vh - 300px);
            overflow-x: auto !important;
            overflow-y: scroll !important;
            position: relative;
            margin-bottom: 0;
            border: 1px solid rgba(197, 160, 89, .14);
            border-radius: 5px;
            overscroll-behavior: contain;
        }

        #tqm-content .tqm-captured-table {
            width: 100%;
            border-collapse: separate !important;
            border-spacing: 0;
        }

        #tqm-content .tqm-captured-table thead th {
            position: sticky !important;
            top: 0 !important;
            z-index: 50 !important;
            background: #171a1d !important;
            box-shadow:
                0 1px 0 rgba(197, 160, 89, .40),
                0 5px 10px rgba(0, 0, 0, .35);
        }

        .tqm-comparison-stack {
            display: grid;
            gap: 18px;
            margin-top: 14px;
        }

        .tqm-comparison-block {
            min-width: 0;
            padding: 14px;
            border: 1px solid rgba(197, 160, 89, .16);
            border-radius: 6px;
            background: rgba(7, 9, 11, .22);
        }

        .tqm-comparison-block h3 {
            margin: 0 0 12px;
            color: #d6ad61;
            font-family: var(--font-heading, Georgia, serif);
            font-size: 15px;
            letter-spacing: .06em;
            text-transform: uppercase;
        }

        .tqm-reference-item {
            color: rgba(232, 224, 208, .78);
            font-size: 11px;
            min-width: 130px;
            white-space: normal;
        }

        .tqm-gathering-card-grid {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 14px;
            margin-top: 18px;
            align-items: start;
        }

        .tqm-gathering-card-grid.tqm-gathering-1 {
            grid-template-columns: 1fr;
        }

        .tqm-gathering-card-grid.tqm-gathering-2 {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .tqm-gathering-card-grid .tqm-gathering-group {
            margin-top: 0;
            min-width: 0;
            padding: 12px;
            background: rgba(7, 9, 11, .26);
            border: 1px solid rgba(197, 160, 89, .14);
            border-radius: 7px;
        }

        .tqm-gathering-card-grid .tqm-table {
            width: 100%;
            table-layout: fixed;
        }

        .tqm-gathering-card-grid .tqm-table th,
        .tqm-gathering-card-grid .tqm-table td {
            padding-left: 7px;
            padding-right: 7px;
        }

        .tqm-gathering-card-grid .tqm-table th:nth-child(1),
        .tqm-gathering-card-grid .tqm-table td:nth-child(1) {
            width: 34%;
        }

        .tqm-gathering-card-grid .tqm-table th:nth-child(2),
        .tqm-gathering-card-grid .tqm-table td:nth-child(2),
        .tqm-gathering-card-grid .tqm-table th:nth-child(3),
        .tqm-gathering-card-grid .tqm-table td:nth-child(3),
        .tqm-gathering-card-grid .tqm-table th:nth-child(4),
        .tqm-gathering-card-grid .tqm-table td:nth-child(4),
        .tqm-gathering-card-grid .tqm-table th:nth-child(5),
        .tqm-gathering-card-grid .tqm-table td:nth-child(5) {
            text-align: right;
        }

        .tqm-processing-layout {
            display: grid;
            grid-template-columns: minmax(0, 1.5fr) minmax(280px, .8fr);
            gap: 14px;
            align-items: start;
        }

        .tqm-processing-layout > .tqm-card {
            min-width: 0;
            margin-bottom: 0;
        }

        .tqm-processing-layout .tqm-table {
            width: 100%;
            table-layout: fixed;
        }

        .tqm-processing-layout .tqm-table th,
        .tqm-processing-layout .tqm-table td {
            padding-left: 8px;
            padding-right: 8px;
        }

        .tqm-processing-layout .tqm-table th:not(:first-child),
        .tqm-processing-layout .tqm-table td:not(:first-child) {
            text-align: right;
        }

        @media (max-width: 1500px) {
            .tqm-gathering-card-grid {
                grid-template-columns: repeat(2, minmax(0, 1fr));
            }
        }

        @media (max-width: 1100px) {
            .tqm-processing-layout {
                grid-template-columns: 1fr;
            }
        }

        @media (max-width: 800px) {
            .tqm-gathering-card-grid {
                grid-template-columns: 1fr;
            }
        }

        .tqm-gathering-group {
            margin-top: 18px;
        }

        .tqm-gathering-group > h3 {
            margin: 0 0 8px;
            color: #d6ad61;
            font-family: var(--font-heading, Georgia, serif);
            font-size: 15px;
            letter-spacing: .06em;
            text-transform: uppercase;
        }

        .tqm-settings-overview {
            margin-bottom: 14px;
        }

        .tqm-settings-status-grid {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 10px;
            margin-top: 16px;
        }

        .tqm-settings-status-grid > div {
            display: grid;
            gap: 4px;
            min-width: 0;
            padding: 12px;
            background: rgba(7, 9, 11, .32);
            border: 1px solid rgba(255, 255, 255, .08);
            border-radius: 6px;
        }

        .tqm-settings-status-grid span,
        .tqm-settings-metric-list span,
        .tqm-diagnostics-list span {
            color: rgba(232, 224, 208, .52);
            font-size: 10px;
            font-weight: 800;
            letter-spacing: .06em;
            text-transform: uppercase;
        }

        .tqm-settings-status-grid strong {
            color: #f2eee4;
            font-size: 15px;
            line-height: 1.25;
        }

        .tqm-settings-status-grid small {
            color: rgba(232, 224, 208, .42);
            font-size: 10px;
        }

        .tqm-settings-status-grid .tqm-status-ok {
            border-color: rgba(130, 210, 105, .24);
        }

        .tqm-settings-status-grid .tqm-status-needed {
            border-color: rgba(240, 196, 92, .24);
        }

        .tqm-settings-layout {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 14px;
            align-items: start;
        }

        .tqm-settings-layout > .tqm-card {
            min-width: 0;
            margin-bottom: 0;
        }

        .tqm-settings-layout > .tqm-card:first-child {
            grid-column: span 2;
        }

        .tqm-settings-button-row,
        .tqm-settings-button-grid {
            display: flex;
            flex-wrap: wrap;
            gap: 9px;
            margin-top: 14px;
        }

        .tqm-settings-button-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .tqm-settings-metric-list,
        .tqm-diagnostics-list {
            display: grid;
            margin-top: 8px;
            overflow: hidden;
            border: 1px solid rgba(255, 255, 255, .07);
            border-radius: 6px;
        }

        .tqm-settings-metric-list > div,
        .tqm-diagnostics-list > div {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            align-items: center;
            gap: 12px;
            padding: 9px 11px;
            background: rgba(7, 9, 11, .25);
            border-bottom: 1px solid rgba(255, 255, 255, .055);
        }

        .tqm-settings-metric-list > div:last-child,
        .tqm-diagnostics-list > div:last-child {
            border-bottom: 0;
        }

        .tqm-inline-number-setting {
            display: flex;
            align-items: center;
            gap: 5px;
        }

        .tqm-inline-number-setting input {
            width: 72px;
            padding: 6px 8px;
            color: #f2eee4;
            text-align: right;
            background: #111417;
            border: 1px solid rgba(196, 151, 65, .28);
            border-radius: 4px;
        }

        .tqm-settings-subheading {
            margin-top: 18px;
        }

        .tqm-data-source-list {
            display: grid;
            gap: 8px;
            margin-top: 10px;
        }

        .tqm-data-source-list > div {
            display: grid;
            gap: 3px;
            padding: 9px 11px;
            background: rgba(7, 9, 11, .28);
            border: 1px solid rgba(255, 255, 255, .06);
            border-radius: 5px;
        }

        .tqm-data-source-list strong {
            color: #d6ad61;
            font-size: 12px;
        }

        .tqm-data-source-list span {
            color: rgba(232, 224, 208, .56);
            font-size: 11px;
            line-height: 1.4;
        }

        .tqm-setting-row {
            display: grid;
            grid-template-columns: minmax(0, 1fr) minmax(120px, 170px);
            align-items: center;
            gap: 12px;
            margin-top: 10px;
        }

        .tqm-setting-row select {
            width: 100%;
        }

        @media (max-width: 1500px) {
            .tqm-settings-layout {
                grid-template-columns: repeat(2, minmax(0, 1fr));
            }

            .tqm-settings-layout > .tqm-card:first-child {
                grid-column: span 2;
            }
        }

        @media (max-width: 1000px) {
            .tqm-settings-status-grid {
                grid-template-columns: repeat(2, minmax(0, 1fr));
            }

            .tqm-settings-layout {
                grid-template-columns: 1fr;
            }

            .tqm-settings-layout > .tqm-card:first-child {
                grid-column: auto;
            }
        }

        @media (max-width: 650px) {
            .tqm-settings-status-grid,
            .tqm-settings-button-grid {
                grid-template-columns: 1fr;
            }
        }

        .tqm-detected-mastery {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 8px 18px;
            margin-bottom: 16px;
        }

        .tqm-mastery-readout {
            display: grid;
            grid-template-columns: minmax(120px, 1fr) auto auto;
            align-items: center;
            gap: 12px;
            padding: 10px 12px;
            border-bottom: 1px solid rgba(255, 255, 255, .06);
        }

        .tqm-mastery-readout strong {
            color: #aee67a;
        }

        .tqm-settings-card {
            display: grid;
            gap: 16px;
        }

        .tqm-settings-section {
            display: grid;
            gap: 10px;
            padding: 14px;
            border: 1px solid rgba(197, 160, 89, .16);
            border-radius: 7px;
            background: rgba(8, 10, 12, .22);
        }

        .tqm-settings-section h3 {
            margin: 0;
            color: #cda85f;
            font-family: var(--font-display, Georgia, serif);
            font-size: 15px;
            font-weight: 700;
            letter-spacing: .07em;
            text-transform: uppercase;
        }

        .tqm-section-title-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
        }

        .tqm-level-editor {
            display: grid;
            grid-template-columns: repeat(5, minmax(0, 1fr));
            gap: 8px;
        }

        .tqm-level-editor label {
            display: grid;
            gap: 4px;
            min-width: 0;
        }

        .tqm-level-editor label > span {
            overflow: hidden;
            color: rgba(232, 224, 208, .58);
            font-size: 9px;
            font-weight: 800;
            letter-spacing: .05em;
            text-overflow: ellipsis;
            text-transform: uppercase;
            white-space: nowrap;
        }

        .tqm-level-editor input {
            width: 100%;
            min-width: 0;
            box-sizing: border-box;
            min-height: 34px;
            padding: 6px 8px;
            border: 1px solid rgba(196, 151, 65, .28);
            border-radius: 5px;
            background: #111417;
            color: #f2eee4;
            font-size: 13px;
        }

        .tqm-level-editor .tqm-level-unknown input {
            border-color: rgba(232, 224, 208, .15);
            color: rgba(232, 224, 208, .45);
        }

        .tqm-compact-note {
            margin: 12px 0 0;
        }

        .tqm-advanced-settings {
            border: 1px solid rgba(197, 160, 89, .18);
            border-radius: 7px;
            background: rgba(8, 10, 12, .22);
        }

        .tqm-advanced-settings summary {
            padding: 13px 14px;
            color: #cda85f;
            font-size: 11px;
            font-weight: 800;
            letter-spacing: .07em;
            text-transform: uppercase;
            cursor: pointer;
            user-select: none;
        }

        .tqm-advanced-settings[open] summary {
            border-bottom: 1px solid rgba(197, 160, 89, .14);
        }

        .tqm-advanced-settings-body {
            display: grid;
            gap: 12px;
            padding: 14px;
        }

        .tqm-checkbox-row {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 14px;
            color: #e8e0d0;
            cursor: pointer;
        }

        .tqm-checkbox-row input {
            width: 17px;
            height: 17px;
            accent-color: #c5a059;
        }

        .tqm-level-summary {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-bottom: 16px;
        }

        .tqm-level-summary span {
            padding: 5px 8px;
            border-radius: 4px;
            font-size: 11px;
        }

        .tqm-level-summary .tqm-level-known {
            color: #aee67a;
            background: rgba(174, 230, 122, .07);
            border: 1px solid rgba(174, 230, 122, .20);
        }

        .tqm-level-summary .tqm-level-unknown {
            color: #f0c45c;
            background: rgba(240, 196, 92, .07);
            border: 1px solid rgba(240, 196, 92, .22);
        }

        .tqm-level-note {
            display: block;
            margin-top: 2px;
            color: rgba(232, 224, 208, .42);
            font-size: 10px;
            font-weight: 400;
        }

        .tqm-table td > small:not(.tqm-level-note) {
            display: block;
            margin-top: 2px;
            color: rgba(232, 224, 208, .42);
            font-size: 10px;
            font-weight: 400;
        }

        .tqm-section-heading-row {
            margin-bottom: 12px;
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 20px;
        }

        .tqm-section-heading-row > div:first-child {
            min-width: 0;
        }

        .tqm-port-badge-group {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
            justify-content: flex-end;
        }

        .tqm-best-port-badge {
            flex: 0 0 auto;
            min-width: 190px;
            padding: 10px 14px;
            text-align: center;
            background: rgba(197, 160, 89, .08);
            border: 1px solid rgba(197, 160, 89, .34);
            border-radius: 6px;
        }

        .tqm-best-port-badge span {
            display: block;
            color: rgba(232, 224, 208, .52);
            font-size: 10px;
            font-weight: 800;
            letter-spacing: .08em;
            text-transform: uppercase;
        }

        .tqm-best-port-badge strong {
            display: block;
            margin-top: 4px;
            color: #f0c45c;
            font-family: var(--font-heading, Georgia, serif);
            font-size: 17px;
        }

        .tqm-port-rate {
            color: #f0c45c;
            font-weight: 700;
        }

        .tqm-planner-add {
            display: grid;
            grid-template-columns:
                minmax(150px, 190px)
                minmax(260px, 520px)
                minmax(130px, 170px)
                auto;
            gap: 12px;
            align-items: end;
            justify-content: start;
            margin-top: 16px;
        }

        .tqm-planner-type,
        .tqm-planner-item,
        .tqm-planner-quantity {
            min-width: 0;
        }

        .tqm-planner-add label {
            display: grid;
            gap: 6px;
        }

        .tqm-planner-add label > span {
            color: rgba(232, 224, 208, .55);
            font-size: 10px;
            font-weight: 700;
            letter-spacing: .08em;
            text-transform: uppercase;
        }

        .tqm-planner-add select,
        .tqm-planner-add input {
            width: 100%;
            box-sizing: border-box;
            min-height: 38px;
            padding: 8px 10px;
            border: 1px solid rgba(196, 151, 65, .32);
            border-radius: 5px;
            background: #111417;
            color: #f2eee4;
        }

        .tqm-planner-ingredient + .tqm-planner-ingredient {
            margin-top: 7px;
        }

        .tqm-planner-ingredient small {
            display: block;
        }

        .tqm-mini-button {
            padding: 6px 9px;
            border: 1px solid rgba(196, 151, 65, .35);
            border-radius: 4px;
            background: rgba(196, 151, 65, .08);
            color: #e4be67;
            cursor: pointer;
            font-size: 10px;
            text-transform: uppercase;
        }

        .tqm-warning-note {
            margin: 14px 0 0;
            color: #efb05b;
            font-size: 12px;
        }

        @media (max-width: 850px) {
            .tqm-planner-add {
                grid-template-columns: 1fr;
            }
        }

        .tqm-ship-form {
            display: grid;
            grid-template-columns: repeat(4, minmax(150px, 1fr));
            gap: 12px;
            margin-top: 16px;
        }

        .tqm-ship-materials-layout {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 14px;
            margin-top: 14px;
        }

        .tqm-compact-heading {
            align-items: flex-start;
            gap: 12px;
        }

        .tqm-compact-heading .tqm-note {
            margin-bottom: 0;
        }

        .tqm-clear-materials {
            flex: 0 0 auto;
            min-width: 82px;
            padding: 8px 14px;
        }

        .tqm-ship-mastery-grid {
            grid-template-columns: repeat(4, minmax(0, 1fr));
        }

        .tqm-ship-materials-layout > .tqm-card {
            margin: 0;
        }

        .tqm-material-columns {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 14px;
            margin-top: 14px;
        }

        .tqm-material-column {
            display: grid;
            gap: 10px;
            align-content: start;
        }

        .tqm-material-column label,
        .tqm-material-column > div {
            display: grid;
            gap: 6px;
        }

        .tqm-material-column label > span,
        .tqm-material-column > div > span,
        .tqm-time-summary span {
            color: rgba(232, 224, 208, .55);
            font-size: 10px;
            font-weight: 700;
            letter-spacing: .06em;
            text-transform: uppercase;
        }

        .tqm-material-column input {
            width: 100%;
            box-sizing: border-box;
            min-height: 38px;
            padding: 8px 10px;
            border: 1px solid rgba(196, 151, 65, .32);
            border-radius: 5px;
            background: #111417;
            color: #f2eee4;
        }

        .tqm-material-summary .tqm-material-column > div,
        .tqm-time-summary > div {
            padding: 11px 12px;
            border: 1px solid rgba(196, 151, 65, .18);
            border-radius: 5px;
            background: rgba(10, 12, 14, .35);
        }

        .tqm-time-summary > div {
            display: grid;
            align-content: start;
            gap: 6px;
            min-width: 0;
        }

        .tqm-material-summary strong,
        .tqm-time-summary strong {
            color: #e8bd57;
            font-size: 20px;
        }

        .tqm-time-summary strong {
            display: block;
            line-height: 1.2;
            white-space: nowrap;
        }

        .tqm-time-summary {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px;
            margin-top: 12px;
        }

        @media (max-width: 1050px) {
            .tqm-ship-materials-layout {
                grid-template-columns: 1fr;
            }

            .tqm-ship-mastery-grid {
                grid-template-columns: repeat(2, minmax(0, 1fr));
            }
        }

        @media (max-width: 650px) {
            .tqm-material-columns,
            .tqm-time-summary,
            .tqm-ship-mastery-grid {
                grid-template-columns: 1fr;
            }
        }

        .tqm-ship-form label {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }

        .tqm-ship-form label:first-child,
        .tqm-ship-preset-field {
            grid-column: span 2;
        }

        .tqm-ship-form span {
            color: rgba(232, 224, 208, .58);
            font-size: 10px;
            font-weight: 800;
            letter-spacing: .08em;
            text-transform: uppercase;
        }

        .tqm-ship-form input,
        .tqm-ship-form select {
            min-height: 38px;
            padding: 8px 10px;
            color: #f4eee2;
            background: #111316;
            border: 1px solid rgba(197, 160, 89, .34);
            border-radius: 5px;
            box-sizing: border-box;
        }

        .tqm-summary-grid {
            display: grid;
            grid-template-columns: repeat(3, minmax(160px, 1fr));
            gap: 10px;
            margin-top: 12px;
        }

        .tqm-summary-grid > div {
            padding: 12px;
            background: rgba(0, 0, 0, .18);
            border: 1px solid rgba(197, 160, 89, .18);
            border-radius: 5px;
        }

        .tqm-summary-grid span {
            display: block;
            color: rgba(232, 224, 208, .50);
            font-size: 10px;
            letter-spacing: .06em;
            text-transform: uppercase;
        }

        .tqm-summary-grid strong {
            display: block;
            margin-top: 5px;
            color: #f0c45c;
            font-size: 18px;
        }

        .tqm-summary-grid small {
            display: block;
            margin-top: 4px;
            color: rgba(232, 224, 208, .48);
            font-size: 10px;
        }

        .tqm-error-text {
            margin: 12px 0 0;
            padding: 12px;
            overflow: auto;
            color: #ff9b91;
            background: rgba(90, 20, 20, .28);
            border: 1px solid rgba(232, 107, 96, .35);
            border-radius: 5px;
            white-space: pre-wrap;
        }

        .tqm-profit-positive {
            color: #aee67a !important;
            font-weight: 700;
        }

        .tqm-profit-negative {
            color: #ef7c73 !important;
            font-weight: 700;
        }

        .tqm-estimated {
            margin-left: 2px;
            color: #f0c45c;
            font-size: 11px;
            font-weight: 800;
        }

        .tqm-header-actions {
            display: flex;
            align-items: flex-start;
            gap: 10px;
        }

        .tqm-header-actions > .tqm-action,
        .tqm-read-exchange-wrap > .tqm-action,
        .tqm-close {
            min-height: 38px;
            box-sizing: border-box;
        }

        .tqm-close {
            width: 38px;
            height: 38px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 0;
            color: #c5a059;
            background: rgba(197, 160, 89, .08);
            border: 1px solid rgba(197, 160, 89, .42);
            border-radius: 5px;
            font-size: 22px;
            line-height: 1;
            cursor: pointer;
        }

        .tqm-close:hover {
            color: var(--gold, #c5a059);
            border-color: rgba(197, 160, 89, .58);
        }

        .tqm-tabs {
            display: flex;
            gap: 4px;
            padding: 8px 14px 0;
            overflow-x: auto;
            border-bottom: 1px solid rgba(197, 160, 89, .20);
            background: rgba(0, 0, 0, .26);
        }

        .tqm-tabs button {
            padding: 10px 14px;
            color: rgba(232, 224, 208, .62);
            background: transparent;
            border: 0;
            border-bottom: 2px solid transparent;
            font: inherit;
            font-size: 12px;
            font-weight: 800;
            letter-spacing: .07em;
            text-transform: uppercase;
            cursor: pointer;
            white-space: nowrap;
        }

        .tqm-tabs button:hover,
        .tqm-tabs button.tqm-active {
            color: var(--gold, #c5a059);
            border-bottom-color: var(--gold, #c5a059);
        }

        #tqm-content {
            overflow: auto;
            padding: 18px;
        }

        .tqm-orders {
            margin-bottom: 18px;
            padding: 22px;
            background:
                linear-gradient(135deg, rgba(197, 160, 89, .15), rgba(197, 160, 89, .04));
            border: 1px solid rgba(197, 160, 89, .50);
            border-radius: 7px;
        }

        .tqm-kicker {
            color: rgba(232, 224, 208, .56);
            font-size: 11px;
            font-weight: 800;
            letter-spacing: .12em;
            text-transform: uppercase;
        }

        .tqm-order-main {
            margin-top: 7px;
            color: var(--gold, #c5a059);
            font-family: var(--font-heading, Georgia, serif);
            font-size: 28px;
            font-weight: 800;
        }

        .tqm-order-sub {
            margin-top: 7px;
            color: rgba(232, 224, 208, .76);
        }

        .tqm-grid {
            display: grid;
            gap: 18px;
        }

        .tqm-grid-2 {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .tqm-card {
            margin-bottom: 18px;
            padding: 18px;
            background: rgba(255, 255, 255, .025);
            border: 1px solid rgba(197, 160, 89, .22);
            border-radius: 7px;
        }

        .tqm-card h2 {
            margin: 0 0 14px;
            color: var(--gold, #c5a059);
            font-family: var(--font-heading, Georgia, serif);
            font-size: 18px;
            letter-spacing: .06em;
            text-transform: uppercase;
        }

        .tqm-note {
            margin: -4px 0 16px;
            color: rgba(232, 224, 208, .56);
            font-size: 12px;
            line-height: 1.5;
        }

        .tqm-rank-row {
            display: grid;
            grid-template-columns: 28px 1fr auto;
            align-items: center;
            gap: 10px;
            padding: 9px 0;
            border-bottom: 1px solid rgba(255, 255, 255, .06);
        }

        .tqm-rank {
            color: rgba(197, 160, 89, .72);
            font-weight: 800;
        }

        .tqm-rank-name {
            display: grid;
            gap: 2px;
        }

        .tqm-rank-name small {
            color: rgba(232, 224, 208, .48);
        }

        .tqm-rank-value {
            color: #f0c45c;
            font-weight: 800;
        }

        .tqm-buy-craft-value {
            display: grid;
            justify-items: end;
            gap: 2px;
            text-align: right;
        }

        .tqm-buy-craft-value small {
            color: rgba(232, 224, 208, .48);
            font-size: 10px;
            font-weight: 600;
            white-space: nowrap;
        }

        @media (max-width: 720px) {
            .tqm-buy-craft-row {
                grid-template-columns: 24px minmax(0, 1fr);
            }

            .tqm-buy-craft-row .tqm-buy-craft-value {
                grid-column: 2;
                justify-items: start;
                text-align: left;
            }

            .tqm-buy-craft-value small {
                white-space: normal;
            }
        }

        .tqm-summary {
            display: flex;
            flex-wrap: wrap;
            gap: 18px;
            color: rgba(232, 224, 208, .72);
        }

        .tqm-vendor-debug {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 10px;
            margin: 14px 0;
            padding: 12px;
            border: 1px solid rgba(197, 160, 89, .22);
            border-radius: 6px;
        }

        .tqm-vendor-debug > div {
            display: grid;
            gap: 4px;
        }

        .tqm-vendor-debug span {
            color: rgba(232, 224, 208, .46);
            font-size: 9px;
            font-weight: 800;
            letter-spacing: .06em;
            text-transform: uppercase;
        }

        .tqm-vendor-debug strong {
            color: #f2eee4;
            font-size: 12px;
            overflow-wrap: anywhere;
        }

        .tqm-progress-controls {
            display: grid;
            grid-template-columns:
                minmax(150px, .8fr)
                minmax(250px, 1.5fr)
                minmax(110px, .6fr)
                minmax(120px, .7fr)
                minmax(120px, .7fr);
            gap: 12px;
            margin-top: 16px;
        }

        .tqm-progress-controls label {
            display: grid;
            gap: 6px;
        }

        .tqm-progress-controls label > span {
            color: rgba(232, 224, 208, .55);
            font-size: 10px;
            font-weight: 700;
            letter-spacing: .08em;
            text-transform: uppercase;
        }

        .tqm-progress-controls select,
        .tqm-progress-controls input {
            width: 100%;
            min-height: 38px;
            box-sizing: border-box;
            padding: 8px 10px;
            border: 1px solid rgba(196, 151, 65, .32);
            border-radius: 5px;
            background: #111417;
            color: #f2eee4;
        }

        .tqm-progress-input-inline {
            display: flex;
            align-items: center;
            gap: 7px;
            min-width: 0;
        }

        .tqm-progress-input-inline input {
            min-width: 0;
        }

        .tqm-progress-restore {
            flex: 0 0 auto;
            min-height: 38px;
            padding: 7px 10px;
            color: #c5a059;
            background: rgba(197, 160, 89, .08);
            border: 1px solid rgba(197, 160, 89, .42);
            border-radius: 5px;
            font: inherit;
            font-size: 10px;
            font-weight: 800;
            letter-spacing: .04em;
            text-transform: uppercase;
            white-space: nowrap;
            cursor: pointer;
        }

        .tqm-progress-restore:hover {
            background: rgba(197, 160, 89, .14);
            border-color: rgba(224, 186, 107, .72);
        }

        .tqm-progress-summary {
            grid-template-columns: repeat(6, minmax(0, 1fr));
        }

        .tqm-progress-divider {
            height: 1px;
            margin: 22px 0 18px;
            background: rgba(197, 160, 89, .18);
        }

        .tqm-progress-goal-heading {
            display: flex;
            align-items: baseline;
            justify-content: space-between;
            gap: 14px;
            margin-bottom: 12px;
        }

        .tqm-progress-goal-heading h3 {
            margin: 0;
            color: #cda85f;
            font-family: var(--font-heading, Georgia, serif);
            font-size: 16px;
            letter-spacing: .07em;
            text-transform: uppercase;
        }

        .tqm-progress-goal-heading span {
            color: rgba(232, 224, 208, .56);
            font-size: 11px;
        }

        .tqm-material-result-grid {
            align-items: stretch;
            margin-bottom: 18px;
        }

        .tqm-material-result-grid > .tqm-card {
            display: flex;
            flex-direction: column;
            min-height: 0;
            margin-bottom: 0;
            padding: 18px 20px;
        }

        .tqm-material-result-heading {
            margin-bottom: 12px;
        }

        .tqm-material-result-heading h2 {
            margin-bottom: 5px;
        }

        .tqm-material-result-heading .tqm-note {
            margin: 0;
            font-family: var(--font-body, "Gothic A1", sans-serif);
            font-size: 12px;
            font-weight: 400;
            line-height: 1.45;
            letter-spacing: 0;
            text-transform: none;
        }

        .tqm-material-result-list {
            display: grid;
            gap: 8px;
            margin-top: auto;
        }

        .tqm-material-empty {
            padding: 13px 14px;
            color: rgba(232, 224, 208, .58);
            background: rgba(7, 9, 11, .28);
            border: 1px solid rgba(197, 160, 89, .13);
            border-radius: 6px;
            font-family: var(--font-body, "Gothic A1", sans-serif);
            font-size: 13px;
            font-weight: 400;
            line-height: 1.45;
            letter-spacing: 0;
            text-align: left;
            text-transform: none;
        }

        .tqm-material-result-item {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            align-items: center;
            gap: 20px;
            min-height: 46px;
            padding: 10px 13px;
            border: 1px solid rgba(197, 160, 89, .16);
            border-radius: 6px;
            background: rgba(7, 9, 11, .34);
        }

        .tqm-material-result-item span {
            min-width: 0;
            color: #f2eee4;
            font-family: var(--font-body, "Gothic A1", sans-serif);
            font-size: 14px;
            font-weight: 650;
            line-height: 1.35;
            letter-spacing: 0;
            text-transform: none;
            overflow-wrap: normal;
            word-break: normal;
        }

        .tqm-material-result-item strong {
            color: #f0c45c;
            font-family: var(--font-body, "Gothic A1", sans-serif);
            font-size: 18px;
            font-weight: 800;
            letter-spacing: 0;
            font-variant-numeric: tabular-nums;
            white-space: nowrap;
        }

        .tqm-xp-profession-row td {
            padding: 13px 14px 8px !important;
            color: #f0c45c;
            background: rgba(197, 160, 89, .10);
            border-top: 1px solid rgba(197, 160, 89, .30);
            border-bottom: 1px solid rgba(197, 160, 89, .18);
            font-family: var(--font-heading, Georgia, serif);
            font-size: 15px;
            font-weight: 800;
            letter-spacing: .07em;
            text-transform: uppercase;
        }

        .tqm-xp-level-row td {
            padding: 8px 14px !important;
            color: rgba(232, 224, 208, .62);
            background: rgba(255, 255, 255, .025);
            border-bottom: 1px solid rgba(255, 255, 255, .055);
            font-size: 10px;
            font-weight: 800;
            letter-spacing: .08em;
            text-transform: uppercase;
        }

        @media (max-width: 1100px) {
            .tqm-progress-controls {
                grid-template-columns: repeat(2, minmax(0, 1fr));
            }

            .tqm-progress-summary {
                grid-template-columns: repeat(3, minmax(0, 1fr));
            }
        }

        @media (max-width: 650px) {
            .tqm-progress-controls,
            .tqm-progress-summary {
                grid-template-columns: 1fr;
            }
        }

        .tqm-xp-toolbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            margin: 12px 0;
        }

        .tqm-xp-toolbar span {
            color: rgba(232, 224, 208, .52);
            font-size: 11px;
        }

        .tqm-row-locked {
            opacity: .48;
        }

        #${OVERLAY_ID}.tqm-hide-locked-skill-rows .tqm-row-locked {
            display: none !important;
        }

        .tqm-feature-toggle-row {
            display: grid;
            grid-template-columns: auto 1fr;
            gap: 10px;
            align-items: start;
            padding: 9px 0;
            border-bottom: 1px solid rgba(255, 255, 255, .06);
            cursor: pointer;
        }

        .tqm-feature-toggle-row:last-child {
            border-bottom: 0;
        }

        .tqm-feature-toggle-row > input {
            margin-top: 3px;
        }

        .tqm-feature-toggle-row > span {
            display: grid;
            gap: 2px;
        }

        .tqm-feature-toggle-row strong {
            color: var(--text-primary, #e8e0d0);
            font-size: 12px;
        }

        .tqm-feature-toggle-row small {
            color: rgba(232, 224, 208, .58);
            font-size: 10px;
            line-height: 1.35;
        }

        .tqm-dev-feature-toggle {
            margin-top: 8px;
            padding-top: 10px;
            border-top: 1px solid rgba(197, 160, 89, .18);
        }

        .tqm-calc-source-indicator {
            display: flex;
            flex-wrap: wrap;
            gap: 4px 7px;
            margin-top: 4px;
            font-size: 8px;
            line-height: 1.2;
            letter-spacing: .02em;
        }

        .tqm-calc-source-indicator > span {
            white-space: nowrap;
        }

        .tqm-source-ok {
            color: #8ddd61;
        }

        .tqm-source-warning {
            color: #e8a55f;
        }

        .tqm-price-freshness {
            display: block;
            margin-top: 2px;
            font-size: 9px;
            font-weight: 700;
            white-space: nowrap;
        }

        .tqm-freshness-fresh {
            color: #8ddd61 !important;
        }

        .tqm-freshness-stale {
            color: #e8a55f !important;
        }

        .tqm-freshness-fallback {
            color: rgba(232, 224, 208, .42) !important;
        }

        .tqm-market-outlier {
            display: block;
            color: #ef6b63;
            font-weight: 800;
        }

        .tqm-market-ok {
            color: #8ddd61;
            font-weight: 700;
        }

        .tqm-table-wrap {
            width: 100%;
            overflow: auto;
            margin-bottom: 12px;
        }

        .tqm-card > .tqm-note:last-child,
        .tqm-card > .tqm-compact-note:last-child {
            margin-top: 12px;
        }

        .tqm-card > .tqm-empty,
        .tqm-card > .tqm-planner-empty,
        .tqm-card > .tqm-summary-table,
        .tqm-card > .tqm-planner-list,
        .tqm-card > .tqm-builder-summary {
            margin-bottom: 12px;
        }

        .tqm-table {
            width: 100%;
            border-collapse: collapse;
            white-space: nowrap;
            font-family: var(--font-body, "Gothic A1", sans-serif);
            font-size: 13px;
            letter-spacing: 0;
            text-transform: none;
        }

        .tqm-table th,
        .tqm-table td {
            padding: 11px 14px;
            text-align: right;
            border-bottom: 1px solid rgba(255, 255, 255, .07);
        }

        .tqm-table tbody td {
            color: rgba(242, 238, 228, .88);
            font-family: var(--font-body, "Gothic A1", sans-serif);
            font-size: 13px;
            font-weight: 450;
            letter-spacing: 0;
            line-height: 1.35;
            text-transform: none;
        }

        .tqm-table tbody td:first-child {
            min-width: 190px;
        }

        .tqm-table tbody td:first-child strong {
            color: #f2eee4;
            font-family: var(--font-body, "Gothic A1", sans-serif);
            font-size: 14px;
            font-weight: 700;
            letter-spacing: 0;
            text-transform: none;
        }

        .tqm-table th:first-child,
        .tqm-table td:first-child {
            text-align: left;
        }

        .tqm-table th {
            position: sticky;
            top: 0;
            z-index: 1;
            color: rgba(197, 160, 89, .88);
            background: #15171a;
            font-size: 11px;
            letter-spacing: .06em;
            text-transform: uppercase;
        }

        .tqm-table th small {
            display: block;
            margin-top: 3px;
            color: rgba(240, 196, 92, .88);
            font-size: 10px;
            font-weight: 700;
            letter-spacing: .02em;
            text-transform: none;
        }

        .tqm-table-compact {
            table-layout: auto;
        }

        .tqm-table-compact th,
        .tqm-table-compact td {
            padding: 11px 14px;
        }

        .tqm-table-compact th:first-child,
        .tqm-table-compact td:first-child {
            position: sticky;
            left: 0;
            z-index: 2;
            background: #17191c;
        }

        .tqm-table-compact thead th:first-child {
            z-index: 3;
        }

        .tqm-table tr:hover td {
            background: rgba(197, 160, 89, .04);
        }

        .tqm-best {
            color: #aee67a;
            font-weight: 800;
        }

        .tqm-empty {
            padding: 18px 0;
            color: rgba(232, 224, 208, .45);
            text-align: center;
        }

        .tqm-mastery-list {
            display: grid;
            gap: 13px;
        }

        .tqm-slider-row {
            display: grid;
            grid-template-columns: 110px minmax(140px, 1fr) 54px;
            align-items: center;
            gap: 12px;
        }

        .tqm-slider-row input {
            width: 100%;
            accent-color: #c5a059;
        }

        .tqm-slider-row strong {
            text-align: right;
            color: #e8e0d0;
        }

        .tqm-total {
            margin-top: 18px;
            padding-top: 14px;
            border-top: 1px solid rgba(197, 160, 89, .22);
            color: rgba(232, 224, 208, .72);
        }

        .tqm-over {
            color: #e86b60;
        }

        .tqm-setting-row {
            display: grid;
            grid-template-columns: 1fr 90px 20px;
            align-items: center;
            gap: 10px;
        }

        .tqm-setting-row input,
        .tqm-setting-row select {
            padding: 8px 10px;
            color: #e8e0d0;
            background: rgba(0, 0, 0, .36);
            border: 1px solid rgba(197, 160, 89, .38);
            border-radius: 4px;
            font: inherit;
        }

        .tqm-setting-row select {
            color: #ffffff;
            background: #181a1f;
            border-color: #8d6a2f;
            color-scheme: dark;
        }

        .tqm-setting-row select option {
            color: #ffffff;
            background: #181a1f;
        }

        .tqm-actions-stack {
            display: grid;
            gap: 10px;
            margin-top: 18px;
        }

        .tqm-action {
            padding: 10px 14px;
            color: #181000;
            background: linear-gradient(135deg, #c5a059, #e0ba6b);
            border: 1px solid rgba(224, 186, 107, .82);
            border-radius: 5px;
            font: inherit;
            font-size: 12px;
            font-weight: 900;
            letter-spacing: .06em;
            text-transform: uppercase;
            cursor: pointer;
        }

        .tqm-action:hover {
            filter: brightness(1.08);
        }

        .tqm-action.tqm-secondary {
            color: #c5a059;
            background: rgba(197, 160, 89, .08);
        }

        .tqm-action.tqm-compact {
            width: auto;
            min-height: 38px;
            padding: 8px 12px;
        }

        #tqm-toast {
            position: fixed;
            left: 50%;
            bottom: 28px;
            z-index: 10000001;
            transform: translate(-50%, 20px);
            padding: 11px 18px;
            color: #e8e0d0;
            background: rgba(9, 11, 14, .97);
            border: 1px solid rgba(197, 160, 89, .62);
            border-radius: 5px;
            opacity: 0;
            pointer-events: none;
            transition: opacity .18s, transform .18s;
        }

        #tqm-toast.tqm-show {
            opacity: 1;
            transform: translate(-50%, 0);
        }

        @media (max-width: 1100px) {
            .tqm-level-editor {
                grid-template-columns: repeat(2, minmax(0, 1fr));
            }
        }

        @media (max-width: 900px) {
            .tqm-setup-status__items {
                grid-template-columns: 1fr;
            }

            .tqm-read-exchange-wrap {
                justify-items: stretch;
            }

            .tqm-read-exchange-wrap small {
                white-space: normal;
            }

            .tqm-vendor-debug {
                grid-template-columns: repeat(2, minmax(0, 1fr));
            }

            .tqm-grid-2 {
                grid-template-columns: 1fr;
            }

            .tqm-section-heading-row {
                flex-direction: column;
            }

            .tqm-ship-form,
            .tqm-summary-grid {
                grid-template-columns: 1fr;
            }

            .tqm-ship-form label:first-child,
            .tqm-ship-preset-field {
                grid-column: auto;
            }

            .tqm-best-port-badge {
                width: 100%;
                box-sizing: border-box;
            }

            .tqm-header {
                flex-wrap: wrap;
            }

            .tqm-header-center {
                order: 3;
                flex-basis: 100%;
            }

            .tqm-header-city,
            .tqm-header-mastery {
                width: 100%;
                justify-content: center;
            }

            .tqm-header-center {
                flex-wrap: wrap;
                gap: 10px;
            }

            .tqm-header-mastery strong {
                max-width: calc(100vw - 130px);
            }

            .tqm-brand {
                font-size: 18px;
            }

            .tqm-order-main {
                font-size: 22px;
            }

            #${BUTTON_ID}.tqm-header-button,
            #${BUTTON_ID}.tqm-floating-button {
                left: 12px;
            }
        }
    `;

    document.head.appendChild(style);


    // =========================================================
    // CTRL-HOVER ITEM INSPECTOR
    // =========================================================

    const ITEM_INSPECTOR_ID = 'tqm-item-inspector';
    let itemInspectorCtrlHeld = false;
    let itemInspectorPinned = false;
    let itemInspectorItemName = '';
    let itemInspectorPointerX = 0;
    let itemInspectorPointerY = 0;
    let itemInspectorLongPressTimer = 0;
    let itemInspectorLongPressStart = null;
    let itemInspectorDrag = null;
    let itemInspectorCompareItemName = '';

    function inventoryQuantityForItem(itemName) {
        const wanted = normalizeName(itemName).toLowerCase();
        if (!wanted) return 0;

        const items = state.inventoryCache?.items || {};
        const key = Object.keys(items).find(
            name => normalizeName(name).toLowerCase() === wanted
        );

        return key ? Number(items[key] || 0) : 0;
    }

    function inspectorPriceRecord(itemName) {
        const normalized = normalizeName(itemName);
        if (!normalized) return null;

        const names = [normalized];
        if (normalized.endsWith('s')) {
            names.push(normalized.slice(0, -1));
        } else {
            names.push(`${normalized}s`);
        }

        return findItemPrice(names);
    }

    function inspectorRecipeForItem(itemName) {
        const wanted = normalizeName(itemName).toLowerCase();
        if (!wanted) return null;

        return plannerRecipeCatalog().find(
            recipe => normalizeName(recipe.name).toLowerCase() === wanted
        ) || null;
    }

    function itemNameFromInspectorTarget(target) {
        const element = target?.nodeType === 1
            ? target
            : target?.parentElement;

        if (!element) return '';

        if (
            element.closest?.(`#${ITEM_INSPECTOR_ID}`) ||
            element.closest?.(`#${OVERLAY_ID}`) ||
            element.closest?.(`#${BUTTON_ID}`) ||
            element.closest?.(`#${VENDOR_BUTTON_ID}`)
        ) {
            return '';
        }

        const inventorySlot = element.closest?.(
            '.sp-hold-slot:not(.sp-hold-slot--empty)'
        );

        if (inventorySlot) {
            return normalizeName(
                inventorySlot.getAttribute('title') ||
                inventorySlot.querySelector('.sp-hold-slot-name')?.textContent ||
                ''
            );
        }

        const marketRow = element.closest?.(
            'tr.mkt-row, [data-mkt-item], .mkt-row'
        );

        if (marketRow) {
            return normalizeName(detectItemName(marketRow));
        }

        const namedElement = element.closest?.('[data-item-name]');
        if (namedElement) {
            return normalizeName(
                namedElement.getAttribute('data-item-name') ||
                namedElement.textContent ||
                ''
            );
        }

        const detail = element.closest?.(
            '.mkt-detail-panel, #mkt-detail, [class*="mkt-detail"]'
        );

        if (detail) {
            return normalizeName(
                detail.querySelector(
                    '.mkt-detail-title, .mkt-item-name, [data-mkt-detail-title], .mkt-detail-header h1, .mkt-detail-header h2, .mkt-detail-header h3'
                )?.textContent ||
                ''
            );
        }

        return '';
    }
    function inspectorCraftAnalysis(itemName) {
        const recipe = inspectorRecipeForItem(itemName);
        if (!recipe) return null;

        return calculateSharedCraftProfit(
            recipe,
            {
                inputMode:
                    recipe.skill === 'carpentry'
                        ? 'opportunity'
                        : 'purchase'
            }
        );
    }

    function inspectorGatheringAnalysis(itemName) {
        const wanted = normalizeName(itemName).toLowerCase();
        if (!wanted) return null;

        const recipe = BUILT_IN_XP_RECIPES.find(candidate =>
            ['logging', 'mining', 'fishing'].includes(candidate.skill) &&
            normalizeName(candidate.item).toLowerCase() === wanted
        );

        if (!recipe) return null;

        const cycle = adjustedCraftTime(
            Number(recipe.cycle) || 0,
            recipe.skill
        );
        const outputPerAction = yieldMultiplier(recipe.skill);
        const outputRecord = inspectorPriceRecord(itemName);
        const sale = bestSaleValue(outputRecord, outputPerAction);
        const saleValue = Number(sale.value);

        const inputs = (recipe.ingredients || []).map(ingredient => {
            const quantity = Math.max(0, Number(ingredient.quantity) || 0);
            const record = inspectorPriceRecord(ingredient.name);
            const purchase = resolveCraftInputCost(record, quantity);

            return {
                name: ingredient.name,
                quantity,
                record,
                value: Number(purchase.value),
                source: purchase.source || 'Unavailable'
            };
        });

        const allInputsKnown = inputs.every(input =>
            Number.isFinite(input.value)
        );
        const inputCost = allInputsKnown
            ? inputs.reduce((sum, input) => sum + input.value, 0)
            : NaN;
        const profitPerAction =
            Number.isFinite(saleValue) && Number.isFinite(inputCost)
                ? saleValue - inputCost
                : NaN;
        const profitPerHour =
            Number.isFinite(profitPerAction) && cycle > 0
                ? goldPerHour(profitPerAction, cycle)
                : NaN;

        return {
            recipe,
            cycle,
            outputPerAction,
            inputs,
            inputCost,
            saleValue,
            saleSource: sale.source || 'Unavailable',
            outputRecord,
            freshness: priceFreshnessInfo([
                outputRecord,
                ...inputs.map(input => input.record)
            ]),
            profitPerAction,
            profitPerHour
        };
    }


    function inspectorComparableMetrics(itemName) {
        const record = inspectorPriceRecord(itemName);
        const instant = bestSaleValue(record, 1);
        const craft = inspectorCraftAnalysis(itemName);
        const gathering = inspectorGatheringAnalysis(itemName);

        return {
            itemName,
            owned: inventoryQuantityForItem(itemName),
            instantValue: Number(instant.value),
            instantSource: instant.source || 'Unavailable',
            profitPerAction: craft
                ? Number(craft.profitPerAction)
                : gathering
                    ? Number(gathering.profitPerAction)
                    : NaN,
            profitPerHour: craft
                ? Number(craft.profitPerHour)
                : gathering
                    ? Number(gathering.profitPerHour)
                    : NaN
        };
    }

    function buildInspectorComparisonHtml(baseItemName) {
        const preferences = {
            ...DEFAULT_STATE.preferences,
            ...(state.preferences || {})
        };

        if (
            !itemInspectorPinned ||
            !preferences.pinnedComparisonEnabled
        ) {
            return '';
        }

        const compareName = normalizeName(
            itemInspectorCompareItemName
        );

        if (
            !compareName ||
            compareName.toLowerCase() ===
                normalizeName(baseItemName).toLowerCase()
        ) {
            return `
                <div class="tqm-inspector-section-title">
                    Comparison
                </div>
                <div class="tqm-inspector-empty">
                    Hold Ctrl over another item to compare it with this pinned item.
                </div>
            `;
        }

        const base =
            inspectorComparableMetrics(baseItemName);
        const compare =
            inspectorComparableMetrics(compareName);
        const formatMetric = (value, formatter) =>
            Number.isFinite(value)
                ? formatter(value)
                : '—';

        return `
            <div class="tqm-inspector-section-title">
                Comparison
            </div>
            <div class="tqm-compare-grid tqm-compare-head">
                <span></span>
                <strong>${escapeHtml(baseItemName)}</strong>
                <strong>${escapeHtml(compareName)}</strong>
            </div>
            <div class="tqm-compare-grid">
                <span>Owned</span>
                <strong>${base.owned.toLocaleString()}</strong>
                <strong>${compare.owned.toLocaleString()}</strong>
            </div>
            <div class="tqm-compare-grid">
                <span>Instant exit</span>
                <strong>${formatMetric(
                    base.instantValue,
                    value => formatGold(
                        value,
                        { allowZero: true }
                    )
                )}</strong>
                <strong>${formatMetric(
                    compare.instantValue,
                    value => formatGold(
                        value,
                        { allowZero: true }
                    )
                )}</strong>
            </div>
            <div class="tqm-compare-grid">
                <span>Profit/action</span>
                <strong>${formatMetric(
                    base.profitPerAction,
                    signedMoney
                )}</strong>
                <strong>${formatMetric(
                    compare.profitPerAction,
                    signedMoney
                )}</strong>
            </div>
            <div class="tqm-compare-grid">
                <span>Profit/hr</span>
                <strong>${formatMetric(
                    base.profitPerHour,
                    signedMoneyPerHour
                )}</strong>
                <strong>${formatMetric(
                    compare.profitPerHour,
                    signedMoneyPerHour
                )}</strong>
            </div>
        `;
    }

    function inspectorSignedClass(value) {
        if (!Number.isFinite(value)) return '';
        return value >= 0
            ? 'tqm-inspector-positive'
            : 'tqm-inspector-negative';
    }
    function buildItemInspectorHtml(itemName) {
        const record = inspectorPriceRecord(itemName);
        const ask = Number(record?.ask || 0);
        const bid = Number(record?.bid || 0);
        const vendor = Number(
            record?.vendorPrice ||
            builtInVendorPrice(itemName) ||
            0
        );
        const owned = inventoryQuantityForItem(itemName);
        const listNet = ask > 0 ? netPrice(ask) : NaN;
        const instant = bestSaleValue(record, 1);
        const craft = inspectorCraftAnalysis(itemName);
        const gathering = inspectorGatheringAnalysis(itemName);
        const freshness = priceFreshnessInfo(record);
        const ownedValue =
            owned > 0 &&
            Number.isFinite(listNet)
                ? owned * listNet
                : owned > 0 &&
                    Number.isFinite(Number(instant.value))
                    ? owned * Number(instant.value)
                    : NaN;

        const ingredientHtml = craft
            ? craft.ingredients.map(ingredient => `
                <div class="tqm-inspector-subrow">
                    <span>
                        ${escapeHtml(
                            `${ingredient.quantity}× ${ingredient.name}`
                        )}
                    </span>
                    <strong>
                        ${Number.isFinite(ingredient.value)
                            ? formatGold(
                                ingredient.value,
                                { allowZero: true }
                            )
                            : '—'}
                    </strong>
                </div>
            `).join('')
            : '';

        const preferences = {
            ...DEFAULT_STATE.preferences,
            ...(state.preferences || {})
        };

        const capacityHtml =
            craft &&
            preferences.showInspectorCraftCapacity
            ? `
                <div class="tqm-inspector-section-title">
                    Craft Capacity
                </div>
                ${craft.ingredients.map(ingredient => `
                    <div class="tqm-inspector-subrow">
                        <span>${escapeHtml(ingredient.name)} owned</span>
                        <strong>
                            ${Number(
                                ingredient.owned || 0
                            ).toLocaleString()}
                            / ${Number(
                                ingredient.quantity || 0
                            ).toLocaleString(undefined, {
                                maximumFractionDigits: 2
                            })}
                        </strong>
                    </div>
                `).join('')}
                <div class="tqm-inspector-row">
                    <span>Actions available</span>
                    <strong>
                        ${Number(
                            craft.maxActions || 0
                        ).toLocaleString()}
                    </strong>
                </div>
                <div class="tqm-inspector-row">
                    <span>Max craftable</span>
                    <strong>
                        ${Number(
                            craft.maxCraftable || 0
                        ).toLocaleString(undefined, {
                            maximumFractionDigits: 2
                        })}
                    </strong>
                </div>
                ${craft.missingMaterials.length
                    ? craft.missingMaterials.map(ingredient => `
                        <div class="tqm-inspector-row tqm-inspector-negative">
                            <span>
                                Missing ${escapeHtml(ingredient.name)}
                            </span>
                            <strong>
                                ${Number(
                                    ingredient.missingForNextAction || 0
                                ).toLocaleString(undefined, {
                                    maximumFractionDigits: 2
                                })}
                            </strong>
                        </div>
                    `).join('')
                    : `
                        <div class="tqm-inspector-source">
                            Enough materials for the next action
                        </div>
                    `}
            `
            : '';

        const lockedHtml = craft?.locked
            ? `
                <div class="tqm-inspector-row tqm-inspector-negative">
                    <span>Status</span>
                    <strong>
                        Locked · ${escapeHtml(
                            craft.recipe.skill
                        )} Lv. ${Number(
                            craft.recipe.requiredLevel || 1
                        )}
                    </strong>
                </div>
            `
            : '';

        return `
            <div class="tqm-inspector-header">
                <div>
                    <small>Quartermaster</small>
                    <strong>${escapeHtml(itemName)}</strong>
                </div>
                <button
                    type="button"
                    class="tqm-inspector-close"
                    title="Close"
                >×</button>
            </div>

            <div class="tqm-inspector-body">
                <div class="tqm-inspector-section-title">
                    Market
                </div>
                <div class="tqm-inspector-row">
                    <span>Ask</span>
                    <strong>
                        ${ask > 0 ? formatGold(ask) : '—'}
                    </strong>
                </div>
                <div class="tqm-inspector-row">
                    <span>Bid</span>
                    <strong>
                        ${bid > 0 ? formatGold(bid) : '—'}
                    </strong>
                </div>
                <div class="tqm-inspector-row">
                    <span>Vendor</span>
                    <strong>
                        ${vendor > 0 ? formatGold(vendor) : '—'}
                    </strong>
                </div>
                <div class="tqm-inspector-row">
                    <span>After tax @ Ask</span>
                    <strong>
                        ${Number.isFinite(listNet)
                            ? formatGold(listNet)
                            : '—'}
                    </strong>
                </div>
                <div class="tqm-inspector-row">
                    <span>Best instant exit</span>
                    <strong>
                        ${Number.isFinite(Number(instant.value)) &&
                        Number(instant.value) > 0
                            ? formatGold(Number(instant.value))
                            : '—'}
                    </strong>
                </div>
                <div class="tqm-inspector-source">
                    ${escapeHtml(
                        instant.source || 'Unavailable'
                    )}
                </div>
                ${preferences.showPriceFreshness ? `
                    <div class="tqm-inspector-row">
                        <span>Price freshness</span>
                        <strong class="${freshness.className}">
                            ${escapeHtml(freshness.label)}
                        </strong>
                    </div>
                ` : ''}

                ${calculationSourceIndicator({
                    source: instant.source || '',
                    recordOrRecords: freshness,
                    includeInventory: true,
                    includeRecipe: false
                })}

                <div class="tqm-inspector-section-title">
                    Inventory
                </div>
                <div class="tqm-inspector-row">
                    <span>Owned</span>
                    <strong>${owned.toLocaleString()}</strong>
                </div>
                <div class="tqm-inspector-row">
                    <span>Net value</span>
                    <strong>
                        ${Number.isFinite(ownedValue)
                            ? formatGold(
                                ownedValue,
                                { allowZero: true }
                            )
                            : '—'}
                    </strong>
                </div>

                ${craft ? `
                    <div class="tqm-inspector-section-title">
                        Crafting
                    </div>
                    ${lockedHtml}
                    ${ingredientHtml}
                    ${craft.fee > 0 ? `
                        <div class="tqm-inspector-subrow">
                            <span>Supply fee</span>
                            <strong>${formatGold(craft.fee)}</strong>
                        </div>
                    ` : ''}
                    <div class="tqm-inspector-row">
                        <span>Input basis</span>
                        <strong>
                            ${craft.inputMode === 'opportunity'
                                ? 'Opportunity cost'
                                : 'Market purchase'}
                        </strong>
                    </div>
                    <div class="tqm-inspector-row">
                        <span>Your yield</span>
                        <strong>
                            ${formatPercent(
                                yieldMasteryPercent(
                                    craft.recipe.skill
                                )
                            )}
                        </strong>
                    </div>
                    <div class="tqm-inspector-row">
                        <span>Output / action</span>
                        <strong>
                            ${craft.outputPerBatch.toLocaleString(
                                undefined,
                                {
                                    maximumFractionDigits: 2
                                }
                            )}
                        </strong>
                    </div>
                    <div class="tqm-inspector-row">
                        <span>Craft time</span>
                        <strong>
                            ${formatCycleSeconds(craft.cycle)}
                        </strong>
                    </div>
                    <div class="tqm-inspector-row">
                        <span>Input value / item</span>
                        <strong>
                            ${Number.isFinite(craft.costPerItem)
                                ? formatGold(
                                    craft.costPerItem,
                                    { allowZero: true }
                                )
                                : '—'}
                        </strong>
                    </div>
                    <div class="tqm-inspector-row ${inspectorSignedClass(
                        craft.profitPerAction
                    )}">
                        <span>Profit / action</span>
                        <strong>
                            ${Number.isFinite(
                                craft.profitPerAction
                            )
                                ? signedMoney(
                                    craft.profitPerAction
                                )
                                : '—'}
                        </strong>
                    </div>
                    <div class="tqm-inspector-row ${inspectorSignedClass(
                        craft.profitPerItem
                    )}">
                        <span>Profit / item</span>
                        <strong>
                            ${Number.isFinite(
                                craft.profitPerItem
                            )
                                ? signedMoney(
                                    craft.profitPerItem
                                )
                                : '—'}
                        </strong>
                    </div>
                    <div class="tqm-inspector-row ${inspectorSignedClass(
                        craft.profitPerHour
                    )}">
                        <span>Profit / hour</span>
                        <strong>
                            ${Number.isFinite(
                                craft.profitPerHour
                            )
                                ? signedMoneyPerHour(
                                    craft.profitPerHour
                                )
                                : '—'}
                        </strong>
                    </div>
                    <div class="tqm-inspector-source">
                        Sell: ${escapeHtml(
                            craft.instantSource ||
                            'Unavailable'
                        )}
                    </div>
                    ${preferences.showPriceFreshness ? `
                        <div class="tqm-inspector-source">
                            Calculation data:
                            ${escapeHtml(craft.freshness.label)}
                        </div>
                    ` : ''}

                    ${calculationSourceIndicator({
                        source: craft.instantSource || '',
                        recordOrRecords: craft.freshness,
                        skill: craft.recipe?.skill || '',
                        includeInventory:
                            Boolean(preferences.showInspectorCraftCapacity),
                        includeRecipe: true
                    })}

                    ${capacityHtml}
                ` : gathering ? `
                    <div class="tqm-inspector-section-title">
                        Gathering
                    </div>
                    ${gathering.inputs.map(input => `
                        <div class="tqm-inspector-subrow">
                            <span>
                                ${escapeHtml(
                                    `${input.quantity}× ${input.name}`
                                )}
                            </span>
                            <strong>
                                ${Number.isFinite(input.value)
                                    ? formatGold(
                                        input.value,
                                        { allowZero: true }
                                    )
                                    : '—'}
                            </strong>
                        </div>
                    `).join('')}
                    <div class="tqm-inspector-row">
                        <span>Your yield</span>
                        <strong>
                            ${gathering.outputPerAction.toLocaleString(
                                undefined,
                                {
                                    maximumFractionDigits: 2
                                }
                            )}
                        </strong>
                    </div>
                    <div class="tqm-inspector-row">
                        <span>Action time</span>
                        <strong>
                            ${formatCycleSeconds(
                                gathering.cycle
                            )}
                        </strong>
                    </div>
                    <div class="tqm-inspector-row">
                        <span>Sell / action</span>
                        <strong>
                            ${Number.isFinite(
                                gathering.saleValue
                            )
                                ? formatGold(
                                    gathering.saleValue,
                                    { allowZero: true }
                                )
                                : '—'}
                        </strong>
                    </div>
                    <div class="tqm-inspector-row ${inspectorSignedClass(
                        gathering.profitPerHour
                    )}">
                        <span>Profit / hour</span>
                        <strong>
                            ${Number.isFinite(
                                gathering.profitPerHour
                            )
                                ? signedMoneyPerHour(
                                    gathering.profitPerHour
                                )
                                : '—'}
                        </strong>
                    </div>
                    <div class="tqm-inspector-source">
                        Sell: ${escapeHtml(
                            gathering.saleSource ||
                            'Unavailable'
                        )}
                    </div>
                    ${preferences.showPriceFreshness ? `
                        <div class="tqm-inspector-source">
                            Calculation data:
                            ${escapeHtml(
                                gathering.freshness.label
                            )}
                        </div>
                    ` : ''}

                    ${calculationSourceIndicator({
                        source: gathering.saleSource || '',
                        recordOrRecords: gathering.freshness,
                        skill: gathering.recipe?.skill || '',
                        includeInventory: false,
                        includeRecipe: true
                    })}
                ` : `
                    <div class="tqm-inspector-empty">
                        No Quartermaster crafting or gathering recipe for this item.
                    </div>
                `}

                ${buildInspectorComparisonHtml(itemName)}
            </div>

            <div class="tqm-inspector-footer">
                ${itemInspectorPinned
                    ? (
                        preferences.pinnedComparisonEnabled
                            ? 'Pinned · drag header · Ctrl-hover another item to compare · × to close'
                            : 'Pinned · drag header · × to close'
                    )
                    : 'Click inspector to pin · release Ctrl to close'}
            </div>
        `;
    }

    function ensureItemInspector() {
        let inspector = document.getElementById(ITEM_INSPECTOR_ID);
        if (inspector) return inspector;

        inspector = document.createElement('div');
        inspector.id = ITEM_INSPECTOR_ID;
        inspector.className = 'tqm-item-inspector';
        inspector.style.display = 'none';
        document.body.appendChild(inspector);

        inspector.addEventListener('click', event => {
            if (event.target.closest('.tqm-inspector-close')) {
                itemInspectorPinned = false;
                itemInspectorCompareItemName = '';
                hideItemInspector();
                event.preventDefault();
                event.stopPropagation();
                return;
            }

            // The live inspector stays fixed after opening, so the user can
            // move the pointer onto it. A single click pins the current item.
            if (!itemInspectorPinned) {
                itemInspectorPinned = true;
                inspector.classList.add(
                    'tqm-item-inspector-pinned'
                );
                renderItemInspector(
                    itemInspectorItemName,
                    true
                );
            }

            event.preventDefault();
            event.stopPropagation();
        });

        inspector.addEventListener('pointerdown', event => {
            if (!itemInspectorPinned) return;
            if (!event.target.closest('.tqm-inspector-header')) return;
            if (event.target.closest('.tqm-inspector-close')) return;
            if (event.button !== 0 && event.pointerType === 'mouse') return;

            const rect = inspector.getBoundingClientRect();
            itemInspectorDrag = {
                pointerId: event.pointerId,
                offsetX: event.clientX - rect.left,
                offsetY: event.clientY - rect.top
            };

            inspector.setPointerCapture?.(event.pointerId);
            inspector.classList.add('tqm-item-inspector-dragging');
            event.preventDefault();
            event.stopPropagation();
        });

        inspector.addEventListener('pointermove', event => {
            if (!itemInspectorDrag ||
                itemInspectorDrag.pointerId !== event.pointerId) return;

            const margin = 8;
            const width = inspector.offsetWidth || 340;
            const height = inspector.offsetHeight || 420;
            const maxLeft = Math.max(margin, window.innerWidth - width - margin);
            const maxTop = Math.max(margin, window.innerHeight - height - margin);
            const left = Math.min(
                maxLeft,
                Math.max(margin, event.clientX - itemInspectorDrag.offsetX)
            );
            const top = Math.min(
                maxTop,
                Math.max(margin, event.clientY - itemInspectorDrag.offsetY)
            );

            inspector.style.left = `${left}px`;
            inspector.style.top = `${top}px`;
            event.preventDefault();
            event.stopPropagation();
        });

        const stopInspectorDrag = event => {
            if (!itemInspectorDrag ||
                itemInspectorDrag.pointerId !== event.pointerId) return;

            try {
                inspector.releasePointerCapture?.(event.pointerId);
            } catch {}

            itemInspectorDrag = null;
            inspector.classList.remove('tqm-item-inspector-dragging');
            event.preventDefault();
            event.stopPropagation();
        };

        inspector.addEventListener('pointerup', stopInspectorDrag);
        inspector.addEventListener('pointercancel', stopInspectorDrag);

        return inspector;
    }

    function positionItemInspector(inspector) {
        if (!inspector) return;

        const margin = 12;
        const offset = 18;
        const width = inspector.offsetWidth || 330;
        const height = inspector.offsetHeight || 420;
        let left = itemInspectorPointerX + offset;
        let top = itemInspectorPointerY + offset;

        if (left + width + margin > window.innerWidth) {
            left = Math.max(margin, itemInspectorPointerX - width - offset);
        }
        if (top + height + margin > window.innerHeight) {
            top = Math.max(margin, window.innerHeight - height - margin);
        }

        inspector.style.left = `${Math.max(margin, left)}px`;
        inspector.style.top = `${Math.max(margin, top)}px`;
    }
    function renderItemInspector(
        itemName,
        preservePosition = false
    ) {
        const normalized = normalizeName(itemName);
        if (!normalized) return;

        scanGameInventory();
        itemInspectorItemName = normalized;

        const inspector = ensureItemInspector();
        const wasVisible =
            inspector.style.display === 'block';
        const previousLeft =
            inspector.style.left;
        const previousTop =
            inspector.style.top;

        inspector.innerHTML =
            buildItemInspectorHtml(normalized);
        inspector.style.display = 'block';
        inspector.classList.toggle(
            'tqm-item-inspector-pinned',
            itemInspectorPinned
        );

        if (
            preservePosition &&
            wasVisible &&
            previousLeft &&
            previousTop
        ) {
            inspector.style.left = previousLeft;
            inspector.style.top = previousTop;
            return;
        }

        requestAnimationFrame(
            () => positionItemInspector(inspector)
        );
    }

    function hideItemInspector() {
        const inspector = document.getElementById(ITEM_INSPECTOR_ID);
        if (inspector) inspector.style.display = 'none';
        if (!itemInspectorPinned) itemInspectorItemName = '';
    }

    const itemInspectorStyle = document.createElement('style');
    itemInspectorStyle.textContent = `
        #${ITEM_INSPECTOR_ID} {
            position: fixed;
            z-index: 10000020;
            width: min(340px, calc(100vw - 24px));
            max-height: calc(100vh - 24px);
            overflow: auto;
            color: var(--text-primary, #e8e0d0);
            background: rgba(19, 22, 24, .985);
            border: 1px solid rgba(197, 160, 89, .72);
            border-radius: 7px;
            box-shadow: 0 10px 34px rgba(0, 0, 0, .72), 0 0 16px rgba(197, 160, 89, .13);
            font-family: var(--font-body, "Gothic A1", sans-serif);
            font-size: 12px;
            user-select: none;
        }

        #${ITEM_INSPECTOR_ID}.tqm-item-inspector-pinned {
            border-color: rgba(224, 195, 106, .95);
            box-shadow: 0 12px 38px rgba(0, 0, 0, .78), 0 0 18px rgba(224, 195, 106, .19);
        }

        #${ITEM_INSPECTOR_ID} .tqm-inspector-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            padding: 10px 11px;
            background: linear-gradient(180deg, rgba(35, 31, 23, .98), rgba(12, 14, 16, .98));
            border-bottom: 1px solid rgba(197, 160, 89, .32);
            cursor: default;
        }

        #${ITEM_INSPECTOR_ID}.tqm-item-inspector-pinned .tqm-inspector-header {
            cursor: move;
            touch-action: none;
        }

        #${ITEM_INSPECTOR_ID}.tqm-item-inspector-dragging .tqm-inspector-header {
            cursor: grabbing;
        }

        #${ITEM_INSPECTOR_ID} .tqm-inspector-header > div {
            display: grid;
            gap: 2px;
            min-width: 0;
        }

        #${ITEM_INSPECTOR_ID} .tqm-inspector-header small {
            color: rgba(197, 160, 89, .72);
            font-size: 9px;
            font-weight: 800;
            letter-spacing: .12em;
            text-transform: uppercase;
        }

        #${ITEM_INSPECTOR_ID} .tqm-inspector-header strong {
            color: var(--gold, #c5a059);
            font-family: var(--font-heading, Georgia, serif);
            font-size: 15px;
            letter-spacing: .03em;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        #${ITEM_INSPECTOR_ID} .tqm-inspector-close {
            width: 26px;
            height: 26px;
            flex: 0 0 auto;
            padding: 0;
            border: 1px solid rgba(255, 255, 255, .13);
            border-radius: 50%;
            color: rgba(255, 255, 255, .62);
            background: rgba(255, 255, 255, .04);
            cursor: pointer;
            font-size: 17px;
            line-height: 1;
        }

        #${ITEM_INSPECTOR_ID} .tqm-inspector-body {
            padding: 8px 11px 10px;
        }

        #${ITEM_INSPECTOR_ID} .tqm-inspector-section-title {
            margin: 9px 0 4px;
            padding-bottom: 4px;
            color: rgba(197, 160, 89, .82);
            border-bottom: 1px solid rgba(197, 160, 89, .17);
            font-size: 9px;
            font-weight: 800;
            letter-spacing: .12em;
            text-transform: uppercase;
        }

        #${ITEM_INSPECTOR_ID} .tqm-inspector-row,
        #${ITEM_INSPECTOR_ID} .tqm-inspector-subrow {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            gap: 12px;
            align-items: baseline;
            padding: 3px 0;
        }

        #${ITEM_INSPECTOR_ID} .tqm-inspector-row span,
        #${ITEM_INSPECTOR_ID} .tqm-inspector-subrow span {
            color: rgba(232, 224, 208, .68);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        #${ITEM_INSPECTOR_ID} .tqm-inspector-row strong,
        #${ITEM_INSPECTOR_ID} .tqm-inspector-subrow strong {
            color: rgba(232, 224, 208, .96);
            text-align: right;
        }

        #${ITEM_INSPECTOR_ID} .tqm-inspector-subrow {
            padding-left: 8px;
            font-size: 11px;
        }

        #${ITEM_INSPECTOR_ID} .tqm-inspector-source {
            margin-top: -1px;
            color: rgba(232, 224, 208, .43);
            font-size: 9px;
            text-align: right;
        }

        #${ITEM_INSPECTOR_ID} .tqm-inspector-positive strong {
            color: #aee67a;
        }

        #${ITEM_INSPECTOR_ID} .tqm-inspector-negative strong {
            color: #ff8b83;
        }

        #${ITEM_INSPECTOR_ID} .tqm-inspector-empty {
            margin-top: 8px;
            color: rgba(232, 224, 208, .48);
            font-size: 10px;
        }


        #${ITEM_INSPECTOR_ID} .tqm-compare-grid {
            display: grid;
            grid-template-columns:
                minmax(76px, .8fr)
                minmax(92px, 1fr)
                minmax(92px, 1fr);
            gap: 8px;
            align-items: baseline;
            padding: 3px 0;
            border-bottom: 1px solid rgba(255, 255, 255, .035);
        }

        #${ITEM_INSPECTOR_ID} .tqm-compare-grid > span {
            color: rgba(232, 224, 208, .55);
            font-size: 10px;
        }

        #${ITEM_INSPECTOR_ID} .tqm-compare-grid > strong {
            min-width: 0;
            color: rgba(232, 224, 208, .92);
            font-size: 10px;
            text-align: right;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        #${ITEM_INSPECTOR_ID} .tqm-compare-head > strong {
            color: var(--gold, #c5a059);
            font-size: 9px;
        }

        #${ITEM_INSPECTOR_ID} .tqm-inspector-footer {
            padding: 7px 10px;
            color: rgba(232, 224, 208, .48);
            background: rgba(255, 255, 255, .025);
            border-top: 1px solid rgba(255, 255, 255, .06);
            font-size: 9px;
            text-align: center;
            letter-spacing: .03em;
        }
    `;
    document.head.appendChild(itemInspectorStyle);

    /* Escape is left entirely to Tidefall. Use × to close a pinned inspector. */

    document.addEventListener('pointermove', event => {
        itemInspectorPointerX = event.clientX;
        itemInspectorPointerY = event.clientY;

        if (itemInspectorLongPressStart) {
            const dx = event.clientX - itemInspectorLongPressStart.x;
            const dy = event.clientY - itemInspectorLongPressStart.y;
            if (Math.hypot(dx, dy) > 12) {
                window.clearTimeout(itemInspectorLongPressTimer);
                itemInspectorLongPressTimer = 0;
                itemInspectorLongPressStart = null;
            }
        }

        // Intentionally do not move the inspector with every pointer event.
        // It is positioned when opened/when the hovered item changes, which
        // leaves it stationary long enough to move onto and click to pin.
    }, { passive: true });

    document.addEventListener('pointerover', event => {
        const preferences = {
            ...DEFAULT_STATE.preferences,
            ...(state.preferences || {})
        };

        if (!preferences.itemInspectorEnabled) {
            if (!itemInspectorPinned) {
                hideItemInspector();
            }
            return;
        }

        if (event.target?.closest?.(`#${ITEM_INSPECTOR_ID}`)) return;

        const itemName = itemNameFromInspectorTarget(event.target);

        if (!itemName) {
            if (itemInspectorCtrlHeld && !itemInspectorPinned) {
                hideItemInspector();
            }
            return;
        }

        if (itemInspectorPinned) {
            if (
                preferences.pinnedComparisonEnabled &&
                itemInspectorCtrlHeld &&
                normalizeName(itemName).toLowerCase() !==
                    normalizeName(itemInspectorItemName).toLowerCase()
            ) {
                itemInspectorCompareItemName = itemName;
                renderItemInspector(
                    itemInspectorItemName,
                    true
                );
            }
            return;
        }

        const inspector =
            document.getElementById(ITEM_INSPECTOR_ID);
        const sameVisibleItem =
            normalizeName(itemInspectorItemName).toLowerCase() ===
                normalizeName(itemName).toLowerCase() &&
            inspector?.style.display === 'block';

        itemInspectorItemName = itemName;

        if (
            itemInspectorCtrlHeld &&
            !sameVisibleItem
        ) {
            renderItemInspector(itemName);
        }
    }, { passive: true });

    document.addEventListener('keydown', event => {
        if (event.key !== 'Control') return;

        const preferences = {
            ...DEFAULT_STATE.preferences,
            ...(state.preferences || {})
        };

        if (!preferences.itemInspectorEnabled) return;
        if (itemInspectorCtrlHeld) return;

        itemInspectorCtrlHeld = true;
        const target = document.elementFromPoint(
            itemInspectorPointerX,
            itemInspectorPointerY
        );
        const itemName = itemNameFromInspectorTarget(target);

        if (
            itemName &&
            itemInspectorPinned &&
            preferences.pinnedComparisonEnabled &&
            normalizeName(itemName).toLowerCase() !==
                normalizeName(itemInspectorItemName).toLowerCase()
        ) {
            itemInspectorCompareItemName = itemName;
            renderItemInspector(
                itemInspectorItemName,
                true
            );
            return;
        }

        if (itemName && !itemInspectorPinned) {
            renderItemInspector(itemName);
        }
    });

    document.addEventListener('keyup', event => {
        if (event.key !== 'Control') return;
        itemInspectorCtrlHeld = false;

        if (!itemInspectorPinned) {
            hideItemInspector();
        }
    });

    document.addEventListener('pointerdown', event => {
        if (event.pointerType === 'mouse') return;

        const preferences = {
            ...DEFAULT_STATE.preferences,
            ...(state.preferences || {})
        };

        if (!preferences.itemInspectorEnabled) return;
        if (event.target?.closest?.(`#${ITEM_INSPECTOR_ID}`)) return;

        const itemName = itemNameFromInspectorTarget(event.target);
        if (!itemName) return;

        window.clearTimeout(itemInspectorLongPressTimer);
        itemInspectorLongPressStart = {
            x: event.clientX,
            y: event.clientY,
            itemName
        };
        itemInspectorPointerX = event.clientX;
        itemInspectorPointerY = event.clientY;

        itemInspectorLongPressTimer = window.setTimeout(() => {
            itemInspectorPinned = true;
            renderItemInspector(itemName);
            itemInspectorLongPressTimer = 0;
            itemInspectorLongPressStart = null;
        }, 550);
    }, { passive: true });

    const cancelItemInspectorLongPress = () => {
        window.clearTimeout(itemInspectorLongPressTimer);
        itemInspectorLongPressTimer = 0;
        itemInspectorLongPressStart = null;
    };

    document.addEventListener('pointerup', cancelItemInspectorLongPress, { passive: true });
    document.addEventListener('pointercancel', cancelItemInspectorLongPress, { passive: true });

    createHeaderButton();
    createJournal();

    /*
     * Performance note:
     * Quartermaster previously ran city, mastery, skill, XP, inventory,
     * button maintenance, and vendor-button maintenance together every
     * 1000 ms. The synchronized work was visible as a regular game hitch.
     * Keep reactive work narrow and stagger slow fallbacks instead.
     */

    const cityObserver = new MutationObserver(() => {
        const changed = autoDetectCurrentCity();

        if (
            changed &&
            document.getElementById(OVERLAY_ID)?.classList.contains('tqm-open')
        ) {
            renderActiveTab(
                document.querySelector('[data-tqm-tab].tqm-active')
                    ?.dataset.tqmTab || 'overview'
            );
        }
    });

    let observedCityButton = null;

    const observeCitySidebar = () => {
        const cityButton = document.querySelector('#city-nav-btn');

        if (!cityButton) {
            if (observedCityButton) {
                cityObserver.disconnect();
                observedCityButton = null;
            }
            return;
        }

        if (cityButton === observedCityButton) {
            return;
        }

        cityObserver.disconnect();
        observedCityButton = cityButton;

        cityObserver.observe(cityButton, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: ['class', 'style']
        });

        autoDetectCurrentCity();
    };

    observeCitySidebar();

    let vendorScanTimer = 0;

    const captureOpenVendorDetail = () => {
        if (!state.developerMode) return;

        window.clearTimeout(vendorScanTimer);

        vendorScanTimer = window.setTimeout(() => {
            const before = Object.values(state.prices).filter(
                record => Number(record.vendorPrice || 0) > 0
            ).length;

            const captured = scanOpenItemDetail();

            if (!captured) return;

            saveState();

            const after = Object.values(state.prices).filter(
                record => Number(record.vendorPrice || 0) > 0
            ).length;

            const overlay = document.getElementById(OVERLAY_ID);
            const activeTab = overlay
                ?.querySelector('[data-tqm-tab].tqm-active')
                ?.dataset.tqmTab;

            if (
                overlay?.classList.contains('tqm-open') &&
                activeTab === 'captured'
            ) {
                renderActiveTab('captured');
            }

            if (after > before) {
                showToast(
                    `Vendor price captured. ${after} total vendor prices saved.`
                );
            }
        }, 100);
    };

    let vendorDetailObserver = null;

    function syncVendorDetailObserver() {
        if (state.developerMode) {
            if (vendorDetailObserver) return;

            vendorDetailObserver = new MutationObserver(
                captureOpenVendorDetail
            );

            vendorDetailObserver.observe(document.documentElement, {
                childList: true,
                subtree: true,
                characterData: true
            });

            captureOpenVendorDetail();
            return;
        }

        if (vendorDetailObserver) {
            vendorDetailObserver.disconnect();
            vendorDetailObserver = null;
        }

        window.clearTimeout(vendorScanTimer);
    }

    syncVendorDetailObserver();

    const refreshOpenShipTabIfNeeded = inventoryUpdated => {
        if (!inventoryUpdated) return;

        const overlay = document.getElementById(OVERLAY_ID);
        const activeTab = overlay
            ?.querySelector('[data-tqm-tab].tqm-active')
            ?.dataset.tqmTab;

        if (
            overlay?.classList.contains('tqm-open') &&
            activeTab === 'ship'
        ) {
            renderActiveTab('ship');
        }
    };

    const runInventoryFallback = () => {
        if (!state.preferences?.autoRefreshInventory) return;

        refreshOpenShipTabIfNeeded(
            scanGameInventory()
        );
    };

    const runPassiveDataFallback = () => {
        const cityChanged = autoDetectCurrentCity();
        scanMasteryFromPage();
        scanSkillLevelsFromPage();

        if (
            cityChanged &&
            document.getElementById(OVERLAY_ID)?.classList.contains('tqm-open')
        ) {
            renderActiveTab(
                document.querySelector('[data-tqm-tab].tqm-active')
                    ?.dataset.tqmTab || 'overview'
            );
        }
    };

    const runUiMaintenance = () => {
        const button = document.getElementById(BUTTON_ID);

        if (!button || !button.isConnected) {
            createHeaderButton();
        }

        observeCitySidebar();
        syncVendorReadButton();
        syncVendorDetailObserver();
    };

    /*
     * Stagger the fallbacks so they do not all wake up on the same frame.
     * XP recipe discovery is intentionally not periodic anymore; it still
     * is retained only as a dormant compatibility helper; verified XP data
     * is built in and no automatic full-page XP scan is performed.
     */
    window.setTimeout(() => {
        runInventoryFallback();
        window.setInterval(runInventoryFallback, 3000);
    }, 900);

    window.setTimeout(() => {
        runUiMaintenance();
        window.setInterval(runUiMaintenance, 4000);
    }, 1900);

    window.setTimeout(() => {
        runPassiveDataFallback();
        window.setInterval(runPassiveDataFallback, 7000);
    }, 3300);

    window.setTimeout(() => {
        recordNetWorthSnapshot();
        window.setInterval(
            recordNetWorthSnapshot,
            NET_WORTH_SNAPSHOT_INTERVAL_MS
        );
    }, 5000);

    console.info(
        `[Tidefall Quartermaster] Loaded v${VERSION} (${BUILD_ID})`
    );

    document.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;

        // Inspector Escape is handled earlier in capture phase. If no
        // inspector is visible, preserve Quartermaster's normal overlay close.
        const overlay = document.getElementById(OVERLAY_ID);
        if (overlay?.classList.contains('tqm-open')) {
            closeOverlay();
        }
    });
})();
