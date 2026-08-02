// ==UserScript==
// @name         Tidefall Quartermaster
// @namespace    tidefall-quartermaster
// @version      1.0.1
// @description  Standalone Exchange reader and mastery-aware profit advisor for Tidefall
// @icon         https://www.google.com/s2/favicons?sz=64&domain=playtidefall.com
// @updateURL    https://raw.githubusercontent.com/UserCarl/tidefall-quartermaster/main/Tidefall_Quartermaster.user.js
// @downloadURL  https://raw.githubusercontent.com/UserCarl/tidefall-quartermaster/main/Tidefall_Quartermaster.user.js
// @match        https://www.playtidefall.com/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const VERSION = '1.0.1';
    const STORAGE_KEY = 'tf-quartermaster-v1';
    const BUTTON_ID = 'tf-quartermaster-button';
    const VENDOR_BUTTON_ID = 'tf-quartermaster-vendor-button';
    const OVERLAY_ID = 'tf-quartermaster-overlay';
    const BUTTON_POSITION_KEY = 'tf-quartermaster-button-position-v1';
    const MARKET_PARSER_VERSION_KEY = 'tf-quartermaster-market-parser-version';
    const MARKET_PARSER_VERSION = 2;
    const EXCLUDE_DEFAULT_MIGRATION_KEY =
        'tf-quartermaster-exclude-default-v1';

    function formatGold(value, { allowZero = false } = {}) {
        const amount = Number(value);

        if (!Number.isFinite(amount)) return '—';
        if (!allowZero && amount <= 0) return '—';

        return `${Math.round(amount).toLocaleString()}g`;
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
            wood: 'Maple',
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
            autoRefreshInventory: true
        },
        masteryUpdatedAt: 0,
        updatedAt: 0
    };

    const WOODS = [
        'Pine', 'Oak', 'Willow', 'Maple', 'Teak',
        'Mahogany', 'Yew', 'Blackwood', 'Ironbark', 'Elderwood'
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
            wood: 'Willow',
            metal: 'Cinder',
            planks: 1875,
            beams: 1000,
            nails: 990,
            shipwrightFee: 9000,
            buildTime: '4h 2m'
        },
        Brig: {
            name: 'Brig Standard',
            wood: 'Maple',
            metal: 'Darkiron',
            planks: 4500,
            beams: 2400,
            nails: 2370,
            shipwrightFee: 21800,
            buildTime: '9h 41m'
        },
        Brigantine: {
            name: 'Brigantine Standard',
            wood: 'Teak',
            metal: 'Mithril',
            planks: 9000,
            beams: 4800,
            nails: 4740,
            shipwrightFee: 43400,
            buildTime: '19h 22m'
        },
        Corvette: {
            name: 'Corvette Standard',
            wood: 'Mahogany',
            metal: 'Adamantite',
            planks: 16000,
            beams: 8000,
            nails: 8500,
            shipwrightFee: 75000,
            buildTime: '1d 9h'
        },
        Frigate: {
            name: 'Frigate Standard',
            wood: 'Yew',
            metal: 'Starmetal',
            planks: 32000,
            beams: 14000,
            nails: 15750,
            shipwrightFee: 139500,
            buildTime: '2d 9h'
        },
        Galleon: {
            name: 'Galleon Standard',
            wood: 'Blackwood',
            metal: 'Stormglass',
            planks: 48000,
            beams: 22000,
            nails: 23750,
            shipwrightFee: 214000,
            buildTime: '3d 22h'
        },
        'Man-of-War': {
            name: 'Man-of-War Standard',
            wood: 'Ironbark',
            metal: 'Leviathan',
            planks: 78000,
            beams: 36000,
            nails: 38500,
            shipwrightFee: 348000,
            buildTime: '6d 10h'
        },
        'Ship of the Line': {
            name: 'Ship of the Line Standard',
            wood: 'Elderwood',
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
        Willow: { plank: 14, beam: 28 },
        Maple: { plank: 18, beam: 36 },
        Teak: { plank: 22, beam: 44 },
        Mahogany: { plank: 30, beam: 60 },
        Yew: { plank: 38, beam: 76 },
        Blackwood: { plank: 46, beam: 92 },
        Ironbark: { plank: 52, beam: 104 },
        Elderwood: { plank: 60, beam: 120 }
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
        Willow: 10,
        Maple: 15,
        Teak: 25,
        Mahogany: 40,
        Yew: 55,
        Blackwood: 70,
        Ironbark: 75,
        Elderwood: 90
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
        Willow: 6,
        Maple: 8,
        Teak: 10,
        Mahogany: 15,
        Yew: 20,
        Blackwood: 26,
        Ironbark: 33,
        Elderwood: 42
    };

    const METAL_FUEL_LOG = {
        Copper: 'Pine',
        Iron: 'Oak',
        Cinder: 'Willow',
        Darkiron: 'Maple',
        Mithril: 'Teak',
        Adamantite: 'Mahogany',
        Starmetal: 'Yew',
        Stormglass: 'Blackwood',
        Leviathan: 'Ironbark',
        Abyssal: 'Elderwood'
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
        'Blackwood Beam': 156,
        'Blackwood Plank': 52,
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
        'Elderwood Beam': 252,
        'Elderwood Plank': 84,
        'Grilled Salmon': 30,
        'Hull Repair Kit': 92,
        'Hull Restoration Kit': 1350,
        'Iron 4-Pounder': 725,
        'Iron Bar': 18,
        'Iron Nails': 6,
        'Iron Ore': 6,
        'Ironbark Beam': 198,
        'Ironbark Plank': 66,
        'Leviathan 32-Pounder': 28000,
        'Leviathan Bar': 99,
        'Leviathan Nails': 54,
        'Leviathan Ore': 33,
        'Mackerel': 5,
        'Mahogany Beam': 90,
        'Mahogany Plank': 30,
        'Maple Beam': 48,
        'Maple Plank': 16,
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
        'Teak Beam': 60,
        'Teak Plank': 20,
        'Tuna': 16,
        'Tuna Rations': 14,
        'Willow Beam': 36,
        'Willow Plank': 12,
        'Worm Bait': 2,
        'Yew Beam': 120,
        'Yew Plank': 40
    };

    function builtInVendorPrice(itemName) {
        const normalized = normalizeName(itemName);
        if (!normalized) return 0;

        const direct = Object.entries(BUILT_IN_VENDOR_PRICES)
            .find(([name]) =>
                normalizeName(name).toLowerCase() ===
                normalized.toLowerCase()
            );

        if (direct) {
            return Number(direct[1] || 0);
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
        Iron: 10,
        Cinder: 15,
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
        { item: 'Grilled Salmon', ingredient: 'Salmon', level: 20, cycle: 15, fee: 6, fuelLog: 'Willow Log' },
        { item: 'Tuna Rations', ingredient: 'Tuna', level: 30, cycle: 18, fee: 4, fuelLog: 'Oak Log' },
        { item: 'Swordfish Cuts', ingredient: 'Swordfish', level: 40, cycle: 22, fee: 8, fuelLog: 'Maple Log' },
        { item: 'Shark Haunch', ingredient: 'Shark', level: 50, cycle: 28, fee: 10, fuelLog: 'Teak Log' },
        { item: 'Deepfin Steaks', ingredient: 'Deepfin Tuna', level: 60, cycle: 35, fee: 15, fuelLog: 'Mahogany Log' },
        { item: 'Stormray Fillet', ingredient: 'Stormray', level: 80, cycle: 45, fee: 26, fuelLog: 'Blackwood Log' },
        { item: 'Dreadwhale Feast', ingredient: 'Dreadwhale', level: 90, cycle: 60, fee: 42, fuelLog: 'Elderwood Log' }
    ];

    const SUPPORTED_XP_SKILLS = [
        'logging',
        'mining',
        'fishing',
        'carpentry',
        'smelting',
        'cooking',
        'crafting'
    ];

    const BUILT_IN_XP_RECIPES = [
        // Logging
        { skill: 'logging', item: 'Pine Log', level: 1, xp: 2, cycle: 6, ingredients: [] },
        { skill: 'logging', item: 'Oak Log', level: 5, xp: 5, cycle: 10, ingredients: [] },
        { skill: 'logging', item: 'Willow Log', level: 10, xp: 8, cycle: 14, ingredients: [] },
        { skill: 'logging', item: 'Maple Log', level: 15, xp: 12, cycle: 18, ingredients: [] },
        { skill: 'logging', item: 'Teak Log', level: 25, xp: 18, cycle: 22, ingredients: [] },
        { skill: 'logging', item: 'Mahogany Log', level: 40, xp: 25, cycle: 30, ingredients: [] },
        { skill: 'logging', item: 'Yew Log', level: 55, xp: 32, cycle: 38, ingredients: [] },
        { skill: 'logging', item: 'Blackwood Log', level: 65, xp: 40, cycle: 46, ingredients: [] },
        { skill: 'logging', item: 'Ironbark Log', level: 75, xp: 50, cycle: 52, ingredients: [] },
        { skill: 'logging', item: 'Elderwood Log', level: 90, xp: 60, cycle: 60, ingredients: [] },

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
        { skill: 'carpentry', item: 'Willow Plank', level: 10, xp: 8, cycle: 14, ingredients: [{ name: 'Willow Log', quantity: 1 }] },
        { skill: 'carpentry', item: 'Willow Beam', level: 10, xp: 16, cycle: 28, ingredients: [{ name: 'Willow Plank', quantity: 2 }] },
        { skill: 'carpentry', item: 'Maple Plank', level: 15, xp: 12, cycle: 18, ingredients: [{ name: 'Maple Log', quantity: 1 }] },
        { skill: 'carpentry', item: 'Maple Beam', level: 15, xp: 24, cycle: 36, ingredients: [{ name: 'Maple Plank', quantity: 2 }] },
        { skill: 'carpentry', item: 'Teak Plank', level: 25, xp: 18, cycle: 22, ingredients: [{ name: 'Teak Log', quantity: 1 }] },
        { skill: 'carpentry', item: 'Teak Beam', level: 25, xp: 36, cycle: 44, ingredients: [{ name: 'Teak Plank', quantity: 2 }] },
        { skill: 'carpentry', item: 'Mahogany Plank', level: 40, xp: 25, cycle: 30, ingredients: [{ name: 'Mahogany Log', quantity: 1 }] },
        { skill: 'carpentry', item: 'Mahogany Beam', level: 40, xp: 50, cycle: 60, ingredients: [{ name: 'Mahogany Plank', quantity: 2 }] },
        { skill: 'carpentry', item: 'Yew Plank', level: 55, xp: 32, cycle: 38, ingredients: [{ name: 'Yew Log', quantity: 1 }] },
        { skill: 'carpentry', item: 'Yew Beam', level: 55, xp: 64, cycle: 76, ingredients: [{ name: 'Yew Plank', quantity: 2 }] },
        { skill: 'carpentry', item: 'Blackwood Plank', level: 70, xp: 40, cycle: 46, ingredients: [{ name: 'Blackwood Log', quantity: 1 }] },
        { skill: 'carpentry', item: 'Blackwood Beam', level: 70, xp: 80, cycle: 92, ingredients: [{ name: 'Blackwood Plank', quantity: 2 }] },
        { skill: 'carpentry', item: 'Ironbark Plank', level: 75, xp: 50, cycle: 52, ingredients: [{ name: 'Ironbark Log', quantity: 1 }] },
        { skill: 'carpentry', item: 'Ironbark Beam', level: 75, xp: 100, cycle: 104, ingredients: [{ name: 'Ironbark Plank', quantity: 2 }] },
        { skill: 'carpentry', item: 'Elderwood Plank', level: 90, xp: 60, cycle: 60, ingredients: [{ name: 'Elderwood Log', quantity: 1 }] },
        { skill: 'carpentry', item: 'Elderwood Beam', level: 90, xp: 120, cycle: 120, ingredients: [{ name: 'Elderwood Plank', quantity: 2 }] },

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
        { skill: 'crafting', item: 'Hull Repair Kit', level: 10, xp: 10, cycle: 18, ingredients: [{ name: 'Cinder Nails', quantity: 3 }, { name: 'Willow Plank', quantity: 4 }] },
        { skill: 'crafting', item: 'Darkiron Nails', level: 15, xp: 14, cycle: 8, ingredients: [{ name: 'Darkiron Bar', quantity: 1 }] },
        { skill: 'crafting', item: 'Deck Repair Kit', level: 15, xp: 14, cycle: 22, ingredients: [{ name: 'Darkiron Nails', quantity: 4 }, { name: 'Maple Plank', quantity: 5 }] },
        { skill: 'crafting', item: 'Mithril Nails', level: 25, xp: 20, cycle: 10, ingredients: [{ name: 'Mithril Bar', quantity: 1 }] },
        { skill: 'crafting', item: 'Reinforcement Kit', level: 25, xp: 22, cycle: 28, ingredients: [{ name: 'Mithril Nails', quantity: 4 }, { name: 'Teak Plank', quantity: 6 }] },
        { skill: 'crafting', item: 'Adamantite Nails', level: 40, xp: 26, cycle: 12, ingredients: [{ name: 'Adamantite Bar', quantity: 1 }] },
        { skill: 'crafting', item: 'Shipwright Kit', level: 40, xp: 30, cycle: 34, ingredients: [{ name: 'Adamantite Nails', quantity: 5 }, { name: 'Mahogany Plank', quantity: 6 }] },
        { skill: 'crafting', item: 'Starmetal Nails', level: 55, xp: 32, cycle: 15, ingredients: [{ name: 'Starmetal Bar', quantity: 1 }] },
        { skill: 'crafting', item: 'Master Repair Kit', level: 55, xp: 38, cycle: 42, ingredients: [{ name: 'Starmetal Nails', quantity: 5 }, { name: 'Yew Plank', quantity: 8 }] },
        { skill: 'crafting', item: 'Stormglass Nails', level: 70, xp: 38, cycle: 18, ingredients: [{ name: 'Stormglass Bar', quantity: 1 }] },
        { skill: 'crafting', item: 'Hull Restoration Kit', level: 70, xp: 48, cycle: 50, ingredients: [{ name: 'Stormglass Nails', quantity: 6 }, { name: 'Blackwood Plank', quantity: 10 }] },
        { skill: 'crafting', item: 'Leviathan Nails', level: 80, xp: 48, cycle: 25, ingredients: [{ name: 'Leviathan Bar', quantity: 1 }] },
        { skill: 'crafting', item: 'Refit Crate', level: 80, xp: 58, cycle: 58, ingredients: [{ name: 'Leviathan Nails', quantity: 8 }, { name: 'Ironbark Plank', quantity: 12 }] },
        { skill: 'crafting', item: 'Abyssal Nails', level: 90, xp: 60, cycle: 35, ingredients: [{ name: 'Abyssal Bar', quantity: 1 }] },
        { skill: 'crafting', item: 'Master Refit Crate', level: 90, xp: 72, cycle: 70, ingredients: [{ name: 'Abyssal Nails', quantity: 10 }, { name: 'Elderwood Plank', quantity: 15 }] }
    ];

    function xpRecipeKey(skill, item) {
        return `${String(skill || '').toLowerCase()}:${normalizeName(item).toLowerCase()}`;
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

        return Object.values(state.xpRecipes).find(recipe =>
            normalizeName(recipe.item).toLowerCase() === normalized
        ) || null;
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

    function selectedProgressRecipe() {
        const recipes = calculateXpRows().filter(
            recipe => SUPPORTED_XP_SKILLS.includes(recipe.skill)
        );
        const skill = SUPPORTED_XP_SKILLS.includes(state.progressPlanner?.skill)
            ? state.progressPlanner.skill
            : 'smelting';
        const skillRecipes = recipes.filter(recipe => recipe.skill === skill);
        const selected = skillRecipes.find(
            recipe => xpRecipeKey(recipe.skill, recipe.item) ===
                state.progressPlanner?.itemKey
        );

        return selected || skillRecipes[0] || null;
    }

    function calculateProgressPlan() {
        const recipe = selectedProgressRecipe();

        if (!recipe) {
            return null;
        }

        const skill = recipe.skill;
        const currentLevel = Math.max(
            1,
            Number(state.skillLevels[skill] || recipe.level || 1)
        );
        const progress = state.skillProgress?.[skill] || {};
        const currentXp = Math.max(0, Number(progress.currentXp || 0));
        const targetLevel = Math.max(
            currentLevel + 1,
            Math.floor(
                Number(state.progressPlanner?.targetLevel) ||
                currentLevel + 1
            )
        );
        const xpNeeded = xpNeededToReachLevel(
            currentLevel,
            currentXp,
            targetLevel
        );
        const actions = Math.ceil(xpNeeded / recipe.xp);
        const cycle = adjustedCraftTime(recipe.cycle, recipe.skill);
        const totalSeconds = actions * cycle;
        const directIngredients = (recipe.ingredients || []).map(
            ingredient => ({
                name: ingredient.name,
                quantity: actions * Number(ingredient.quantity || 0)
            })
        );
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

        return {
            recipe,
            skill,
            currentLevel,
            currentXp,
            targetLevel,
            xpNeeded,
            actions,
            cycle,
            totalSeconds,
            directIngredients,
            baseMaterials
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
            const level = Number(skillMatch[2] || 0);
            const xp = numberFromText(xpNode.textContent);
            const cycle = parseDisplayedCycle(cardText);

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

            let item = normalizeName(titleElement?.textContent);

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

            if (
                saveXpRecipe({
                    skill,
                    item,
                    xp,
                    cycle,
                    level,
                    source: 'page'
                })
            ) {
                captured += 1;
            }
        });

        if (captured > 0) {
            saveState();
        }

        return captured;
    }

    function calculateXpRows() {
        return BUILT_IN_XP_RECIPES
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
                const xpPerHour = recipe.cycle > 0
                    ? xp * 3600 / recipe.cycle
                    : 0;

                return {
                    ...recipe,
                    baseXp,
                    xp,
                    source: 'built-in',
                    canMake,
                    xpPerHour
                };
            })
            .filter(recipe => recipe.xp > 0 && recipe.cycle > 0)
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
                }
            };
        } catch {
            return structuredClone(DEFAULT_STATE);
        }
    }

    let state = loadState();

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
         * Tidefall keeps the current port name in the left sidebar while
         * docked, even when the city panel is closed.
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
            select.value = detected;
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
            ? base / (1 + bonus)
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

        MASTERY_SKILLS.forEach(skill => {
            state.mastery[skill] = found[skill] || {
                experience: 0,
                yield: 0
            };
        });

        state.masteryUpdatedAt = Date.now();
        saveState();
        updateHeaderMasteryDisplay();

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
                state.skillProgress[skill] = {
                    currentXp: numberFromText(xpMatch[1]),
                    requiredXp: numberFromText(xpMatch[2]),
                    updatedAt: Date.now()
                };
            }
        });

        const count = Object.keys(found).length;

        if (!count) {
            return 0;
        }

        Object.entries(found).forEach(([skill, level]) => {
            state.skillLevels[skill] = level;
        });

        saveState();
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

    function depthPriceFromSide(root, side) {
        const sideLabel = exactTextElements(root, side)[0];
        if (!sideLabel) return 0;

        const section = closestMarketSection(
            sideLabel,
            side === 'SELLER' ? 'buyer' : 'seller'
        ) || root;

        const opposite = exactTextElements(
            section,
            side === 'SELLER' ? 'BUYER' : 'SELLER'
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
                const comesAfter =
                    Boolean(relationToLabel & Node.DOCUMENT_POSITION_FOLLOWING);

                if (!comesAfter) return false;

                if (opposite) {
                    const relationToOpposite =
                        row.compareDocumentPosition(opposite);
                    const comesBeforeOpposite =
                        Boolean(
                            relationToOpposite &
                            Node.DOCUMENT_POSITION_FOLLOWING
                        );

                    if (!comesBeforeOpposite) return false;
                }

                const cells = directVisibleChildren(row);
                return cells.length >= 3 && cells.length <= 6;
            });

        for (const row of candidates) {
            const cells = directVisibleChildren(row);
            const values = cells.map(cell => normalizeName(cell.innerText));

            /*
             * Market depth rows are Seller/Buyer, Location, Price, Quantity.
             * Prefer the third visible cell, then fall back to the first
             * numeric cell after the location.
             */
            const preferred = numberFromText(values[2]);
            if (preferred > 0) return preferred;

            for (let index = 1; index < values.length; index += 1) {
                const value = numberFromText(values[index]);
                if (value > 0) return value;
            }
        }

        return 0;
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

        const vendorPrice = numberFromText(rawText);
        const estimatedAsk =
            detailValueByLabel(detailContainer, 'ESTIMATED ASK') ||
            depthPriceFromSide(detailContainer, 'SELLER');
        const highestBid =
            depthPriceFromSide(detailContainer, 'BUYER');
        const tradeMedian =
            recentTradeMedian(detailContainer, 5);

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
            ask: estimatedAsk > 0
                ? estimatedAsk
                : Number(existing.ask || 0),
            bid: highestBid > 0
                ? highestBid
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
                    estimatedAsk || '—'
                }, bid ${highestBid || '—'}, recent median ${
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
                source: 'Lowest Sell',
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

    function exchangeBuyCost(record, quantity = 1) {
        const count = Math.max(0, Number(quantity) || 0);
        const marketAnalysis = analyzeMarketPrice(record);
        const marketPrice = marketAnalysis.price;

        return {
            value: marketPrice > 0
                ? marketPrice * count
                : NaN,
            source: marketPrice > 0
                ? 'Lowest Sell'
                : 'Unavailable',
            marketPrice,
            marketSource: marketAnalysis.source,
            askRejected: marketAnalysis.askRejected,
            bidIgnored: marketAnalysis.bidIgnored
        };
    }

    function resolveCraftInputCost(record, quantity = 1) {
        const count = Math.max(0, Number(quantity) || 0);
        const purchase = exchangeBuyCost(record, count);

        if (Number.isFinite(purchase.value) && purchase.value > 0) {
            return {
                ...purchase,
                source: 'Lowest Sell'
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
                bid: 0,
                vendorPrice: 0,
                recentTradeMedian: 0
            };
        }

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

        const bidNet = bid > 0 ? netPrice(bid) : 0;

        if (bidNet > 0 || vendorPrice > 0) {
            return bidNet >= vendorPrice
                ? {
                    netUnitValue: bidNet,
                    source: 'Exchange Buy Order',
                    bid,
                    vendorPrice,
                    recentTradeMedian
                }
                : {
                    netUnitValue: vendorPrice,
                    source: 'Vendor',
                    bid,
                    vendorPrice,
                    recentTradeMedian
                };
        }

        if (recentTradeMedian > 0) {
            return {
                netUnitValue: netPrice(recentTradeMedian),
                source: 'Recent Trade Estimate',
                bid,
                vendorPrice,
                recentTradeMedian
            };
        }

        return {
            netUnitValue: 0,
            source: 'Unavailable',
            bid,
            vendorPrice,
            recentTradeMedian
        };
    }

    function bestSaleValue(record, quantity = 1) {
        const count = Math.max(0, Number(quantity) || 0);
        const sale = analyzeImmediateSale(record);
        const value = sale.netUnitValue > 0
            ? sale.netUnitValue * count
            : NaN;

        return {
            value,
            source: sale.source,
            exchangeValue:
                sale.source === 'Exchange Buy Order'
                    ? value
                    : NaN,
            vendorValue:
                sale.vendorPrice > 0
                    ? sale.vendorPrice * count
                    : NaN,
            marketPrice: sale.bid,
            vendorPrice: sale.vendorPrice,
            recentTradeMedian: sale.recentTradeMedian,
            marketSource: sale.source,
            askRejected: false,
            bidIgnored: false
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

            const logSale = exchangeBuyCost(logRecord, 1);
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
             * Each output is valued at its net Exchange listing value.
             */
            const plankInput = resolveCraftInputCost(
                logRecord,
                1
            );
            const plankInputCost = plankInput.value;
            const plankActionSale = bestAvailableSaleValue(
                plankRecord,
                carpentry
            );
            const plankOutputValue = plankActionSale.value;
            const plankActionProfit =
                Number.isFinite(plankInputCost) &&
                Number.isFinite(plankOutputValue)
                    ? plankOutputValue - plankInputCost
                    : NaN;
            const plankActionProfitHour = goldPerHour(
                plankActionProfit,
                plankCycle
            );

            const beamInput = resolveCraftInputCost(
                plankRecord,
                2
            );
            const beamInputCost = beamInput.value;
            const beamActionSale = bestAvailableSaleValue(
                beamRecord,
                carpentry
            );
            const beamOutputValue = beamActionSale.value;
            const beamActionProfit =
                Number.isFinite(beamInputCost) &&
                Number.isFinite(beamOutputValue)
                    ? beamOutputValue - beamInputCost
                    : NaN;
            const beamActionProfitHour = goldPerHour(
                beamActionProfit,
                beamCycle
            );

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

            const requiredLevel = WOOD_REQUIRED_LEVELS[wood] || 1;
            const canCraft = hasRequiredLevel('carpentry', requiredLevel);

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
            const barActionInput = resolveCraftInputCost(
                oreRecord,
                2
            );
            const barActionInputCost = barActionInput.value;
            const barActionSale = bestAvailableSaleValue(
                barRecord,
                smelting
            );
            const barActionOutputValue = barActionSale.value;
            const barActionProfit =
                Number.isFinite(barActionInputCost) &&
                Number.isFinite(barActionOutputValue)
                    ? barActionOutputValue -
                        barActionInputCost -
                        Number(feeInfo.fee || 0)
                    : NaN;
            const barActionProfitHour = goldPerHour(
                barActionProfit,
                barCycle
            );

            const nailActionInput = resolveCraftInputCost(
                barRecord,
                1
            );
            const nailActionInputCost = nailActionInput.value;
            const nailsPerAction = 4 * crafting;
            const nailActionSale = bestAvailableSaleValue(
                nailRecord,
                nailsPerAction
            );
            const nailActionOutputValue = nailActionSale.value;
            const nailActionProfit =
                Number.isFinite(nailActionInputCost) &&
                Number.isFinite(nailActionOutputValue)
                    ? nailActionOutputValue -
                        nailActionInputCost
                    : NaN;
            const nailActionProfitHour = goldPerHour(
                nailActionProfit,
                nailCycle
            );

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
            const outputPerBatch = outputMultiplier;
            const canCraft = hasRequiredLevel('cooking', recipe.level);

            const ingredientSale = resolveCraftInputCost(
                ingredientRecord,
                1
            );
            const cookedSale = bestAvailableSaleValue(
                cookedRecord,
                outputPerBatch
            );
            const hasPrices =
                ingredientSale.value > 0 &&
                cookedSale.value > 0;

            const grossAfterTax = hasPrices
                ? cookedSale.value
                : NaN;

            const ingredientOpportunityCost = hasPrices
                ? ingredientSale.value
                : NaN;

            const profitPerBatch = hasPrices
                ? grossAfterTax -
                    ingredientOpportunityCost -
                    Number(recipe.fee || 0)
                : NaN;

            const currentCycle = adjustedCraftTime(
                recipe.cycle,
                'cooking'
            );

            const currentProfitHour = Number.isFinite(profitPerBatch)
                ? goldPerHour(profitPerBatch, currentCycle)
                : NaN;

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
                                <tr>
                                    <td>
                                        <strong>
                                            ${escapeHtml(row.ingredient)}
                                            →
                                            ${escapeHtml(row.item)}
                                        </strong>
                                        <small class="tqm-level-note">
                                            Lv. ${row.level}
                                        </small>
                                    </td>
                                    <td class="${
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
                                        ${escapeHtml(
                                            row.cookedSale?.source || 'N/A'
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
                                <tr>
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

                const outputPerBatch =
                    SHOT_OUTPUT_PER_BATCH * smithingMastery;

                const itemSale = bestAvailableSaleValue(
                    itemRecord,
                    outputPerBatch
                );
                const grossSaleValue = itemSale.value;
                const barOpportunityCost = barSale.value;
                const hasPrices =
                    Number.isFinite(grossSaleValue) &&
                    Number.isFinite(barOpportunityCost);

                const profitPerBatch = hasPrices
                    ? grossSaleValue -
                        barOpportunityCost -
                        Number(feeInfo.fee || 0)
                    : NaN;

                const currentCycle = adjustedCraftTime(
                    SHOT_CRAFT_TIMES[metal],
                    'smithing'
                );

                const currentProfitHour = goldPerHour(
                    profitPerBatch,
                    currentCycle
                );

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
                    barSale,
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
                                <th>Resource</th>
                                <th>Profit</th>
                                <th>Profit/hr</th>
                                <th>Sell</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows.map(row => `
                                <tr>
                                    <td>
                                        <strong>
                                            ${escapeHtml(row.itemName)}
                                        </strong>
                                        <small class="tqm-level-note">
                                            Lv. ${row.requiredLevel}
                                        </small>
                                    </td>
                                    <td class="${
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
                                        ${escapeHtml(
                                            row.itemSale?.source || 'N/A'
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
                                <tr>
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
            { name: 'Willow Plank', quantity: 4 }
        ]},
        { item: 'Deck Repair Kit', level: 15, cycle: 22, ingredients: [
            { name: 'Darkiron Nails', quantity: 4 },
            { name: 'Maple Plank', quantity: 5 }
        ]},
        { item: 'Reinforcement Kit', level: 25, cycle: 28, ingredients: [
            { name: 'Mithril Nails', quantity: 4 },
            { name: 'Teak Plank', quantity: 6 }
        ]},
        { item: 'Shipwright Kit', level: 40, cycle: 34, ingredients: [
            { name: 'Adamantite Nails', quantity: 5 },
            { name: 'Mahogany Plank', quantity: 6 }
        ]},
        { item: 'Master Repair Kit', level: 55, cycle: 42, ingredients: [
            { name: 'Starmetal Nails', quantity: 5 },
            { name: 'Yew Plank', quantity: 8 }
        ]},
        { item: 'Hull Restoration Kit', level: 70, cycle: 50, ingredients: [
            { name: 'Stormglass Nails', quantity: 6 },
            { name: 'Blackwood Plank', quantity: 10 }
        ]},
        { item: 'Refit Crate', level: 80, cycle: 58, ingredients: [
            { name: 'Leviathan Nails', quantity: 8 },
            { name: 'Ironbark Plank', quantity: 12 }
        ]},
        { item: 'Master Refit Crate', level: 90, cycle: 70, ingredients: [
            { name: 'Abyssal Nails', quantity: 10 },
            { name: 'Elderwood Plank', quantity: 15 }
        ]}
    ];

    const CANNON_RECIPES = [
        { item: 'Copper 2-Pounder', metal: 'Copper', wood: 'Pine', level: 1, cycle: 30, bars: 20, beams: 5 },
        { item: 'Iron 4-Pounder', metal: 'Iron', wood: 'Oak', level: 5, cycle: 45, bars: 22, beams: 6 },
        { item: 'Cinder 6-Pounder', metal: 'Cinder', wood: 'Willow', level: 10, cycle: 60, bars: 24, beams: 7 },
        { item: 'Darkiron 8-Pounder', metal: 'Darkiron', wood: 'Maple', level: 20, cycle: 90, bars: 28, beams: 8 },
        { item: 'Mithril 9-Pounder', metal: 'Mithril', wood: 'Teak', level: 30, cycle: 120, bars: 34, beams: 10 },
        { item: 'Adamantite 12-Pounder', metal: 'Adamantite', wood: 'Mahogany', level: 40, cycle: 180, bars: 42, beams: 13 },
        { item: 'Starmetal 18-Pounder', metal: 'Starmetal', wood: 'Yew', level: 50, cycle: 300, bars: 55, beams: 17 },
        { item: 'Stormglass 24-Pounder', metal: 'Stormglass', wood: 'Blackwood', level: 60, cycle: 600, bars: 80, beams: 24 },
        { item: 'Leviathan 32-Pounder', metal: 'Leviathan', wood: 'Ironbark', level: 70, cycle: 900, bars: 150, beams: 40 },
        { item: 'Abyssal 42-Pounder', metal: 'Abyssal', wood: 'Elderwood', level: 80, cycle: 1800, bars: 350, beams: 60 }
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

    function applyCachedInventoryToShipBuilder() {
        const wood = WOODS.includes(state.shipBuilder?.wood)
            ? state.shipBuilder.wood
            : 'Maple';
        const metal = METALS.includes(state.shipBuilder?.metal)
            ? state.shipBuilder.metal
            : 'Darkiron';
        const items = state.inventoryCache?.items || {};

        state.shipBuilder = {
            ...state.shipBuilder,
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

    function scanGameInventory() {
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
        const changed =
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

        applyCachedInventoryToShipBuilder();

        if (changed) {
            saveState();
        }

        return changed;
    }

    function calculateShipBuild() {
        applyCachedInventoryToShipBuilder();

        const build = state.shipBuilder || DEFAULT_STATE.shipBuilder;
        const inventory = {
            ...DEFAULT_STATE.shipBuilder.inventory,
            ...(build.inventory || {})
        };

        const wood = WOODS.includes(build.wood) ? build.wood : 'Maple';
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

        const logPrice =
            chosenMarketPrice(logRecord) ||
            Number(VENDOR_LOG_VALUES[wood] || 0);
        const plankPrice = chosenMarketPrice(plankRecord);
        const beamPrice = chosenMarketPrice(beamRecord);
        const orePrice = chosenMarketPrice(oreRecord);
        const barPrice = chosenMarketPrice(barRecord);
        const nailPrice = chosenMarketPrice(nailRecord);

        const rawMaterialCost =
            remainingLogs * logPrice +
            remainingOre * orePrice +
            shipwrightFee;

        const finishedMaterialCost =
            remainingFinishedPlanks * plankPrice +
            remainingBeams * beamPrice +
            remainingNails * nailPrice +
            shipwrightFee;

        const intermediateMaterialCost =
            remainingFinishedPlanks * plankPrice +
            remainingBeams * beamPrice +
            remainingBars * barPrice +
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

        const barsToSmelt = Math.max(
            0,
            totalBarsNeeded - haveBars - (haveOre * smeltingYield / 2)
        );

        const totalCraftSeconds =
            logActions * plankTime +
            beamActions * beamTime +
            (barsToSmelt / smeltingYield) * barTime +
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
            rawMaterialCost,
            finishedMaterialCost,
            intermediateMaterialCost,
            totalCraftSeconds
        };
    }

    function renderShipBuilder() {
        const result = calculateShipBuild();

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
                    <h2>Remaining Materials Required</h2>

                    <div class="tqm-material-columns tqm-material-summary">
                        <div class="tqm-material-column">
                            <div class="${result.remainingLogs <= 0 ? 'tqm-state-positive' : 'tqm-state-warning'}">
                                <span>${escapeHtml(result.wood)} Logs</span>
                                <strong>${result.remainingLogs.toLocaleString()}</strong>
                            </div>
                            <div class="${result.remainingFinishedPlanks <= 0 ? 'tqm-state-positive' : 'tqm-state-warning'}">
                                <span>${escapeHtml(result.wood)} Planks</span>
                                <strong>${result.remainingFinishedPlanks.toLocaleString()}</strong>
                            </div>
                            <div class="${result.remainingBeams <= 0 ? 'tqm-state-positive' : 'tqm-state-warning'}">
                                <span>${escapeHtml(result.wood)} Beams</span>
                                <strong>${result.remainingBeams.toLocaleString()}</strong>
                            </div>
                        </div>

                        <div class="tqm-material-column">
                            <div class="${result.remainingOre <= 0 ? 'tqm-state-positive' : 'tqm-state-warning'}">
                                <span>${escapeHtml(result.metal)} Ore</span>
                                <strong>${result.remainingOre.toLocaleString()}</strong>
                            </div>
                            <div class="${result.remainingBars <= 0 ? 'tqm-state-positive' : 'tqm-state-warning'}">
                                <span>${escapeHtml(result.metal)} Bars</span>
                                <strong>${result.remainingBars.toLocaleString()}</strong>
                            </div>
                            <div class="${result.remainingNails <= 0 ? 'tqm-state-positive' : 'tqm-state-warning'}">
                                <span>${escapeHtml(result.metal)} Nails</span>
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

            ${(() => {
                const xpRows = shipBuildXpSummary(result);

                return `
                    <section class="tqm-card">
                        <h2>Build Progress Projection</h2>
                        <p class="tqm-note">
                            Estimated XP assumes you gather the remaining raw
                            materials and craft every remaining intermediate item.
                        </p>

                        <div class="tqm-table-wrap">
                            <table class="tqm-table tqm-table-compact">
                                <thead>
                                    <tr>
                                        <th>Profession</th>
                                        <th>XP Earned</th>
                                        <th>Current Level</th>
                                        <th>Projected Level</th>
                                        <th>Progress After Build</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${xpRows.map(row => `
                                        <tr>
                                            <td><strong>${escapeHtml(
                                                row.skill[0].toUpperCase() +
                                                row.skill.slice(1)
                                            )}</strong></td>
                                            <td class="tqm-profit-positive">
                                                +${Math.floor(row.xp).toLocaleString()} XP
                                            </td>
                                            <td>Lv. ${row.currentLevel}</td>
                                            <td>Lv. ${row.projected.level}</td>
                                            <td>
                                                ${Math.floor(row.projected.xp).toLocaleString()}
                                                / ${row.projected.required.toLocaleString()} XP
                                            </td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </section>
                `;
            })()}

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
                                <td><strong>Gather / Buy Raw</strong></td>
                                <td>${formatGold(result.rawMaterialCost)}</td>
                                <td>
                                    ${result.remainingLogs.toLocaleString()} ${escapeHtml(result.wood)} Logs,
                                    ${result.remainingOre.toLocaleString()} ${escapeHtml(result.metal)} Ore,
                                    shipwright fee
                                </td>
                            </tr>
                            <tr>
                                <td><strong>Buy Planks, Beams, and Bars</strong></td>
                                <td>${formatGold(result.intermediateMaterialCost)}</td>
                                <td>
                                    Remaining finished wood, ${result.remainingBars.toLocaleString()} bars,
                                    nail crafting, shipwright fee
                                </td>
                            </tr>
                            <tr>
                                <td><strong>Buy All Finished Materials</strong></td>
                                <td>${formatGold(result.finishedMaterialCost)}</td>
                                <td>
                                    Planks, beams, nails, shipwright fee
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <p class="tqm-note">
                    A missing Exchange price is treated as zero. Read the relevant
                    Exchange categories before relying on the cost comparison.
                    Profit calculations require active sell listings for logs and finished materials. Missing listings show N/A.
                </p>
            </section>

            <section class="tqm-card">
                <h2>Current Mastery</h2>
                <div class="tqm-summary-grid tqm-ship-mastery-grid">
                    <div>
                        <span>Carpentry Mastery</span>
                        <strong>${yieldMasteryPercent('carpentry')}%</strong>
                        <small>${Math.round(result.carpentryYield * 100)}% total output</small>
                    </div>
                    <div>
                        <span>Smelting Mastery</span>
                        <strong>${yieldMasteryPercent('smelting')}%</strong>
                        <small>${Math.round(result.smeltingYield * 100)}% total output</small>
                    </div>
                    <div>
                        <span>Crafting Mastery</span>
                        <strong>${yieldMasteryPercent('crafting')}%</strong>
                        <small>${Math.round(result.craftingYield * 100)}% total output</small>
                    </div>
                    <div>
                        <span>Current City</span>
                        <strong>${escapeHtml(state.currentCity)}</strong>
                    </div>
                </div>
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
        const selectedRecipe = plan?.recipe || null;
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
                                        ${escapeHtml(recipe.item)} · ${recipe.xp} XP
                                    </option>
                                `;
                            }).join('')}
                        </select>
                    </label>

                    <label>
                        <span>Current Level</span>
                        <input type="number" value="${plan?.currentLevel || 1}" disabled>
                    </label>

                    <label>
                        <span>Current XP</span>
                        <input
                            id="tqm-progress-current-xp"
                            type="number"
                            min="0"
                            step="1"
                            value="${plan?.currentXp || 0}"
                        >
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
                        <h3>Level Goal</h3>
                        <span>
                            ${escapeHtml(plan.recipe.item)}
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
                            <span>Actions Required</span>
                            <strong>${plan.actions.toLocaleString()}</strong>
                        </div>
                        <div>
                            <span>Estimated Time</span>
                            <strong>${formatSeconds(plan.totalSeconds)}</strong>
                        </div>
                        <div>
                            <span>XP / Action</span>
                            <strong>${plan.recipe.xp.toLocaleString()} XP</strong>
                        </div>
                        <div>
                            <span>XP / Hour</span>
                            <strong>${formatXpPerHour(plan.recipe.xpPerHour)}</strong>
                        </div>
                    </div>
                ` : ''}
            </section>

            ${plan ? `
                <div class="tqm-grid tqm-grid-2 tqm-material-result-grid">
                    <section class="tqm-card">
                        <div class="tqm-material-result-heading">
                            <h2>Required Inputs</h2>
                            <p class="tqm-note">
                                Materials consumed directly by the selected action.
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
                            <h2>Raw Resources to Gather</h2>
                            <p class="tqm-note">
                                Intermediate recipes are reduced to their original resources.
                            </p>
                        </div>

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
            return supportedXpRowsForSkill(skill).map(recipe => {
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
                    inputCost
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

        scanXpRecipesFromPage();
        const xpRows = calculateXpRows();
        const bestXp = xpRows.find(
            row => !state.excludeLockedCrafts || row.canMake
        ) || xpRows[0] || null;

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
                        ${topValue
                            ? `${escapeHtml(topValue.order)}: ${escapeHtml(topValue.item)}`
                            : 'Capture Exchange prices to begin'}
                    </h2>
                    <p>
                        ${topValue
                            ? `Best captured value per gathered unit: ${formatGold(topValue.value)}`
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



                <article class="tqm-metric-card ${queue.rows.length ? 'tqm-state-warning' : 'tqm-state-muted'}">
                    <span>Crafting Queue</span>
                    <strong>${queue.rows.length.toLocaleString()} items</strong>
                    <small>${formatSeconds(queue.totalSeconds)}</small>
                </article>

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

    function renderWood() {
        const rows = calculateWoodRows();

        return `
            <div class="tqm-processing-layout">
            <section class="tqm-card">
                <div class="tqm-section-heading-row">
                    <div>
                        <h2>Wood Crafting Profit</h2>
                        <p class="tqm-note">
                            Profit compares the finished output with the input
                            value. Inputs use the lowest sell listing when available,
                            otherwise their immediate sale value.
                        </p>
                    </div>
                </div>

                <div class="tqm-table-wrap">
                    <table class="tqm-table tqm-table-compact">
                        <thead>
                            <tr>
                                <th>Resource</th>
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
                                                ${escapeHtml(row.material)}
                                            </strong>
                                            <small class="tqm-level-note">
                                                Lv. ${row.requiredLevel}
                                            </small>
                                        </td>
                                        <td>Log → Planks</td>
                                        <td class="${
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
                                            ${escapeHtml(
                                                row.plankActionSale?.source ||
                                                'N/A'
                                            )}
                                        </td>
                                    </tr>
                                `,
                                `
                                    <tr>
                                        <td>
                                            <strong>
                                                ${escapeHtml(row.material)}
                                            </strong>
                                        </td>
                                        <td>2 Planks → Beams</td>
                                        <td class="${
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
                                            ${escapeHtml(
                                                row.beamActionSale?.source ||
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
                                <tr>
                                    <td>
                                        <strong>
                                            ${escapeHtml(row.material)}
                                        </strong>
                                    </td>
                                    <td>
                                        ${formatSeconds(
                                            adjustedCraftTime(
                                                WOOD_CRAFT_TIMES[
                                                    row.material
                                                ]?.plank,
                                                'carpentry'
                                            )
                                        )}
                                    </td>
                                    <td>
                                        ${formatSeconds(
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
                                <th>Resource</th>
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
                                                ${escapeHtml(row.material)}
                                            </strong>
                                            <small class="tqm-level-note">
                                                Lv. ${row.barRequiredLevel}
                                            </small>
                                        </td>
                                        <td>2 Ore → Bars</td>
                                        <td class="${
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
                                                ${escapeHtml(row.material)}
                                            </strong>
                                        </td>
                                        <td>1 Bar → Nails</td>
                                        <td class="${
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
                                        ${formatSeconds(
                                            adjustedCraftTime(
                                                METAL_CRAFT_TIMES[
                                                    row.material
                                                ]?.bar,
                                                'smelting'
                                            )
                                        )}
                                    </td>
                                    <td>
                                        ${formatSeconds(
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

        if (skill === 'carpentry') {
            return calculateWoodRows()
                .flatMap(row => [
                    {
                        item: `${row.material} Log → Planks`,
                        value: goldPerHour(
                            bestAvailableSaleValue(
                                findItemPrice([
                                    `${row.material} Plank`,
                                    `${row.material} Planks`
                                ]),
                                yieldMultiplier('logging') *
                                    yieldMultiplier('carpentry')
                            ).value,
                            yieldMultiplier('logging') *
                                row.plankChainTime
                        ),
                        source:
                            row.plankRecommendation?.source ||
                            'Unavailable'
                    },
                    {
                        item: `${row.material} Planks → Beams`,
                        value: goldPerHour(
                            bestAvailableSaleValue(
                                findItemPrice([
                                    `${row.material} Beam`,
                                    `${row.material} Beams`
                                ]),
                                yieldMultiplier('logging') *
                                    (yieldMultiplier('carpentry') / 2) *
                                    yieldMultiplier('carpentry')
                            ).value,
                            yieldMultiplier('logging') *
                                row.beamChainTime
                        ),
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
                    value: goldPerHour(
                        bestAvailableSaleValue(
                            findItemPrice([
                                `${row.material} Bar`,
                                `${row.material} Bars`
                            ]),
                            yieldMultiplier('mining') *
                                yieldMultiplier('smelting') / 2
                        ).value,
                        yieldMultiplier('mining') *
                            row.barChainTime
                    ),
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
                    value: goldPerHour(
                        bestAvailableSaleValue(
                            findItemPrice([
                                `${row.material} Nail`,
                                `${row.material} Nails`
                            ]),
                            yieldMultiplier('mining') *
                                yieldMultiplier('smelting') / 2 *
                                4 *
                                yieldMultiplier('crafting')
                        ).value,
                        yieldMultiplier('mining') *
                            row.nailChainTime
                    ),
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
                bestMasteryOpportunity(skill)
        }));

        const simulated = withTemporaryMasteryAllocations(
            allocations,
            () => ({
                ship: calculateShipBuild(),
                rows: SIMULATED_MASTERY_SKILLS.map(skill => ({
                    skill,
                    xp: bestMasteryXpOpportunity(
                        skill,
                        allocations[skill].experiencePoints
                    ),
                    gold: bestMasteryOpportunity(skill)
                }))
            })
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
                simulatedGold: simulatedRow.gold || null
            };
        });

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
                tab === 'gathering' ? renderGathering() :
                tab === 'wood' ? renderWood() :
                tab === 'metal' ? renderMetal() :
                tab === 'ammo' ? renderAmmunition() :
                tab === 'cooking' ? renderCooking() :
                tab === 'xp' ? renderXpPlanner() :
                tab === 'planner' ? renderCraftingPlanner() :
                tab === 'ship' ? renderShipBuilder() :
                tab === 'simulator' ? renderMasterySimulator() :
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

        document.querySelector(
            '#tqm-toggle-inventory-panel'
        )?.addEventListener('click', () => {
            scanGameInventory();

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

            scanGameInventory();
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
                wood: document.querySelector('#tqm-ship-wood')?.value || 'Maple',
                metal: document.querySelector('#tqm-ship-metal')?.value || 'Darkiron',
                planks: positiveNumber(document.querySelector('#tqm-ship-planks')?.value),
                beams: positiveNumber(document.querySelector('#tqm-ship-beams')?.value),
                nails: positiveNumber(document.querySelector('#tqm-ship-nails')?.value),
                shipwrightFee: positiveNumber(document.querySelector('#tqm-ship-fee')?.value),
                inventory: {
                    ...DEFAULT_STATE.shipBuilder.inventory,
                    ...(state.shipBuilder?.inventory || {})
                },
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
                showToast('Owned ship materials cleared.');
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
                const currentLevel = Math.max(
                    1,
                    Number(state.skillLevels[recipe?.skill] || 1)
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

        document.querySelector('#tqm-progress-current-xp')?.addEventListener(
            'change',
            event => {
                const recipe = selectedProgressRecipe();
                if (!recipe) return;

                state.skillProgress[recipe.skill] = {
                    ...(state.skillProgress[recipe.skill] || {}),
                    currentXp: Math.max(0, Math.floor(Number(event.target.value) || 0)),
                    requiredXp: xpRequiredForLevel(
                        Number(state.skillLevels[recipe.skill] || 1)
                    ),
                    updatedAt: Date.now()
                };
                saveState();
                renderActiveTab('xp');
            }
        );

        document.querySelector('#tqm-read-xp')?.addEventListener(
            'click',
            () => {
                const captured = scanXpRecipesFromPage();
                showToast(
                    captured > 0
                        ? `Captured ${captured} visible XP recipes.`
                        : 'No XP recipes found. Open a profession recipe page first.'
                );
                renderActiveTab('xp');
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
                    includeVendorDetail: false
                });
                showToast(`Captured ${captured} visible Exchange rows.`);
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

                scanGameInventory();
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
                applyCachedInventoryToShipBuilder();
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
            ['#tqm-pref-compact', 'compactMode']
        ].forEach(([selector, key]) => {
            document.querySelector(selector)?.addEventListener(
                'change',
                event => {
                    updatePreference(key, Boolean(event.target.checked));
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
                                title="Selecting a city keeps that manual choice."
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
                        <div class="tqm-read-exchange-wrap">
                            <button id="tqm-scan-now" class="tqm-action tqm-compact">Read Exchange</button>
                            <small>Exchange market table must be open.</small>
                        </div>
                        <button id="tqm-close" class="tqm-close" title="Close">×</button>
                    </div>
                </header>

                <nav class="tqm-tabs">
                    <button data-tqm-tab="overview" class="tqm-active">Dashboard</button>
                    <button data-tqm-tab="gathering">Gathering</button>
                    <button data-tqm-tab="wood">Wood</button>
                    <button data-tqm-tab="metal">Metal</button>
                    <button data-tqm-tab="ammo">Ammunition</button>
                    <button data-tqm-tab="cooking">Cooking</button>
                    <button data-tqm-tab="xp">XP Planner</button>
                    <button data-tqm-tab="planner">Queue Planner</button>
                    <button data-tqm-tab="ship">Ship Builder</button>
                    <button data-tqm-tab="simulator">Mastery Simulator</button>
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
        overlay.addEventListener('click', event => {
            if (event.target === overlay) closeOverlay();
        });

        overlay.querySelectorAll('[data-tqm-tab]').forEach(button => {
            button.addEventListener('click', () => renderActiveTab(button.dataset.tqmTab));
        });

        overlay.querySelector('#tqm-header-city-select').addEventListener('change', event => {
            state.currentCity = event.target.value;
            state.manualCityOverride = true;
            saveState();
            showToast(`City locked to ${state.currentCity}.`);
            renderActiveTab(
                overlay.querySelector('[data-tqm-tab].tqm-active')?.dataset.tqmTab || 'overview'
            );
        });

        overlay.querySelector('#tqm-scan-now').addEventListener('click', () => {
            const activeTab =
                overlay.querySelector('[data-tqm-tab].tqm-active')
                    ?.dataset.tqmTab ||
                'overview';

            const captured = scanVisibleExchange({
                includeVendorDetail: false
            });

            showToast(
                `Captured ${captured} visible Exchange rows.`
            );
            renderActiveTab(activeTab);
        });

        updateHeaderMasteryDisplay();
        renderActiveTab('overview');
    }

    function openOverlay() {
        autoDetectCurrentCity();
        scanMasteryFromPage();
        scanSkillLevelsFromPage();
        scanXpRecipesFromPage();
        createOverlay();
        scanVisibleExchange();

        const overlay = document.getElementById(OVERLAY_ID);
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
        button.title = 'Open Quartermaster’s Ledger';
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
            align-items: center;
            gap: 10px;
        }

        .tqm-close {
            width: 38px;
            height: 38px;
            color: rgba(255, 255, 255, .68);
            background: rgba(255, 255, 255, .04);
            border: 1px solid rgba(255, 255, 255, .14);
            border-radius: 50%;
            font-size: 24px;
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

    createHeaderButton();

    const headerObserver = new MutationObserver(() => {
        if (!document.getElementById(BUTTON_ID)) {
            createHeaderButton();
        }

        syncVendorReadButton();
    });

    headerObserver.observe(document.documentElement, {
        childList: true,
        subtree: true
    });

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

    const observeCitySidebar = () => {
        const cityButton = document.querySelector('#city-nav-btn');

        if (!cityButton || cityButton.dataset.tqmCityObserved === 'true') {
            return;
        }

        cityButton.dataset.tqmCityObserved = 'true';

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
        }, 80);
    };

    const vendorDetailObserver = new MutationObserver(
        captureOpenVendorDetail
    );

    vendorDetailObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true
    });

    captureOpenVendorDetail();

    const sidebarObserver = new MutationObserver(observeCitySidebar);
    sidebarObserver.observe(document.documentElement, {
        childList: true,
        subtree: true
    });

    setInterval(() => {
        const cityChanged = autoDetectCurrentCity();
        scanMasteryFromPage();
        scanSkillLevelsFromPage();
        scanXpRecipesFromPage();

        const inventoryUpdated =
            state.preferences?.autoRefreshInventory
                ? scanGameInventory()
                : false;

        if (
            inventoryUpdated &&
            document.getElementById(OVERLAY_ID)?.classList.contains('tqm-open') &&
            document.querySelector('[data-tqm-tab].tqm-active')
                ?.dataset.tqmTab === 'ship'
        ) {
            renderActiveTab('ship');
        } else if (
            cityChanged &&
            document.getElementById(OVERLAY_ID)?.classList.contains('tqm-open')
        ) {
            renderActiveTab(
                document.querySelector('[data-tqm-tab].tqm-active')
                    ?.dataset.tqmTab || 'overview'
            );
        }

        const button = document.getElementById(BUTTON_ID);

        if (!button || !button.isConnected) {
            createHeaderButton();
        }

        syncVendorReadButton();
    }, 1000);

    console.info(
        `[Tidefall Quartermaster] Loaded v${VERSION}`
    );

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') closeOverlay();
    });
})();
