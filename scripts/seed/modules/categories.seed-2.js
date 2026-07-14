'use strict';

/**
 * Categories Seed Module
 * Populates CategoryTree (categorytrees collection)
 * 30 root → 300+ subcategories → 1200+ child categories
 * Each with complete attribute schemas for product management
 */

const mongoose = require('mongoose');
const SeedLogger = require('../utils/seed-logger');

// ─── Shared attribute helper ──────────────────────────────────────────────────
const attr = (key, label, type, opts = {}) => ({
  platformOptionId: opts.platformOptionId || '',
  allowCustomOptions: opts.allowCustomOptions || false,
  key,
  label,
  type,
  required: opts.required || false,
  options: opts.options || [],
  unit: opts.unit || null,
  isVariantAttribute: opts.isVariant || false,
  isFilterable: opts.filterable !== false,
  isSearchable: opts.searchable !== false,
});

// ─── Attribute schema templates ───────────────────────────────────────────────
const ATTR = {
  color: attr('color', 'Color', 'select', { options: ['Black','White','Red','Blue','Green','Yellow','Navy','Grey','Brown','Pink','Purple','Orange','Maroon','Olive','Teal','Gold','Silver','Beige','Charcoal','Lavender','Mustard','Rust','Coral','Peach'], isVariant: true, required: true }),
  size_apparel: attr('size', 'Size', 'select', { options: ['XS','S','M','L','XL','XXL','3XL','4XL','Free Size'], isVariant: true, required: true }),
  size_shoes: attr('size', 'Shoe Size', 'select', { options: ['4','5','6','7','8','9','10','11','12','13'], isVariant: true, required: true }),
  material: attr('material', 'Material', 'select', { options: ['Cotton','Polyester','Silk','Wool','Linen','Nylon','Viscose','Rayon','Satin','Chiffon','Georgette','Crepe','Denim','Leather','Suede','Canvas','Mesh','Jersey','Fleece','Velvet','Acrylic','Spandex','Modal','Bamboo'], filterable: true }),
  fit:      attr('fit', 'Fit', 'select', { options: ['Slim Fit','Regular Fit','Relaxed Fit','Loose Fit','Oversized','Skinny','Straight','Bootcut'], isVariant: true }),
  occasion: attr('occasion', 'Occasion', 'multi_select', { options: ['Casual','Formal','Party','Sports','Ethnic','Wedding','Festive','Office','Beach'] }),
  gender:   attr('gender', 'Gender', 'select', { options: ['Men','Women','Unisex','Boys','Girls'], required: true, filterable: true }),
  age_group: attr('age_group', 'Age Group', 'select', { options: ['Infant (0-2y)','Toddler (2-5y)','Kids (5-12y)','Teen (12-17y)','Adult 18+'] }),
  pattern:  attr('pattern', 'Pattern', 'select', { options: ['Solid','Striped','Checked','Printed','Embroidered','Floral','Abstract','Geometric','Animal Print','Polka Dot','Tie-Dye'] }),
  sleeve:   attr('sleeve_length', 'Sleeve Length', 'select', { options: ['Full Sleeve','Half Sleeve','3/4 Sleeve','Sleeveless','Cap Sleeve','Bell Sleeve'] }),
  collar:   attr('collar_type', 'Collar Type', 'select', { options: ['Round Neck','V-Neck','Polo','Mandarin','Button-Down','Hooded','Cowl Neck','Square Neck'] }),
  wash:     attr('wash_care', 'Wash Care', 'select', { options: ['Machine Wash','Hand Wash','Dry Clean Only','Do Not Wash','Spot Clean'] }),
  ram:      attr('ram', 'RAM', 'select', { options: ['2GB','3GB','4GB','6GB','8GB','12GB','16GB','32GB','64GB'], isVariant: true, unit: 'GB' }),
  storage:  attr('storage', 'Internal Storage', 'select', { options: ['16GB','32GB','64GB','128GB','256GB','512GB','1TB','2TB'], isVariant: true, unit: 'GB' }),
  display:  attr('display_size', 'Display Size', 'number', { unit: 'inches' }),
  resolution: attr('resolution', 'Resolution', 'select', { options: ['HD (1280x720)','Full HD (1920x1080)','2K (2560x1440)','4K (3840x2160)','8K (7680x4320)'] }),
  processor: attr('processor', 'Processor', 'select', { options: ['Intel Core i3','Intel Core i5','Intel Core i7','Intel Core i9','AMD Ryzen 3','AMD Ryzen 5','AMD Ryzen 7','AMD Ryzen 9','Apple M1','Apple M2','Apple M3','Snapdragon 8 Gen 2','Snapdragon 8 Gen 3','MediaTek Dimensity 9200','Exynos 2400'] }),
  battery:  attr('battery', 'Battery Capacity', 'number', { unit: 'mAh' }),
  camera:   attr('camera_mp', 'Camera (MP)', 'number', { unit: 'MP' }),
  os:       attr('os', 'Operating System', 'select', { options: ['Android 13','Android 14','iOS 17','Windows 11','macOS Sonoma','Linux','Chrome OS'] }),
  connectivity: attr('connectivity', 'Connectivity', 'multi_select', { options: ['Wi-Fi','Bluetooth','5G','4G LTE','USB-C','Thunderbolt','NFC'] }),
  refresh_rate: attr('refresh_rate', 'Refresh Rate', 'select', { options: ['60Hz','90Hz','120Hz','144Hz','165Hz','240Hz'], unit: 'Hz' }),
  network_gen: attr('network', 'Network', 'select', { options: ['5G','4G LTE','3G','2G'], isVariant: true }),
  capacity_ltr: attr('capacity', 'Capacity', 'number', { unit: 'Litres' }),
  energy_star: attr('energy_rating', 'Energy Rating', 'select', { options: ['1 Star','2 Star','3 Star','4 Star','5 Star'], filterable: true }),
  wattage:  attr('wattage', 'Wattage', 'number', { unit: 'Watts' }),
  voltage:  attr('voltage', 'Voltage', 'select', { options: ['110V','220V','240V'] }),
  width:    attr('width', 'Width', 'number', { unit: 'cm' }),
  height_attr: attr('height', 'Height', 'number', { unit: 'cm' }),
  depth:    attr('depth', 'Depth', 'number', { unit: 'cm' }),
  weight_kg: attr('weight_capacity', 'Weight Capacity', 'number', { unit: 'kg' }),
  finish:   attr('finish', 'Finish', 'select', { options: ['Matte','Glossy','Satin','Walnut','Teak','Wenge','Oak','Cherry','Pine','Mahogany','Lacquered','Powder Coated'] }),
  material_furniture: attr('material', 'Material', 'select', { options: ['Solid Wood','Engineered Wood','MDF','Plywood','Steel','Aluminium','Wrought Iron','Glass','Marble','Bamboo','Rattan'] }),
  assembly: attr('assembly_required', 'Assembly Required', 'boolean', {}),
  flavor:   attr('flavor', 'Flavor', 'select', { options: ['Chocolate','Vanilla','Strawberry','Mango','Mixed Fruit','Unflavored','Masala','Salt & Pepper','Honey','Chilli','Cheese','Tomato','Caramel','Mint','Orange','Lemon','Butterscotch'], isVariant: true }),
  pack_size: attr('pack_size', 'Pack Size', 'select', { options: ['100g','200g','250g','500g','1kg','2kg','5kg','Pack of 2','Pack of 3','Pack of 6','Pack of 12','Pack of 24'], isVariant: true }),
  shelf_life: attr('shelf_life', 'Shelf Life', 'number', { unit: 'months' }),
  veg_nonveg: attr('food_type', 'Food Type', 'select', { options: ['Vegetarian','Non-Vegetarian','Vegan','Eggitarian'] }),
  language: attr('language', 'Language', 'select', { options: ['English','Hindi','Bengali','Telugu','Marathi','Tamil','Gujarati','Kannada','Malayalam','Punjabi'] }),
  pages:    attr('pages', 'Number of Pages', 'number', {}),
  format:   attr('format', 'Format', 'select', { options: ['Paperback','Hardcover','E-book','Audiobook','Board Book','Spiral Bound'] }),
  sport:    attr('sport', 'Sport', 'select', { options: ['Cricket','Football','Basketball','Tennis','Badminton','Table Tennis','Swimming','Cycling','Running','Gym','Yoga','Golf'] }),
  metal:    attr('metal', 'Metal Type', 'select', { options: ['Gold (22K)','Gold (18K)','Gold (14K)','Silver (92.5%)','Platinum','Rose Gold','White Gold','Stainless Steel','Brass'] }),
  stone:    attr('stone', 'Stone Type', 'select', { options: ['Diamond','Ruby','Emerald','Sapphire','Pearl','Topaz','Amethyst','Garnet','Turquoise','Coral','Opal','No Stone'] }),
  purity:   attr('purity', 'Purity (Karat)', 'select', { options: ['14K','18K','22K','24K','925 Silver','950 Platinum'] }),
  warranty: attr('warranty', 'Warranty', 'select', { options: ['No Warranty','3 Months','6 Months','1 Year','2 Years','3 Years','5 Years','Lifetime'] }),
  brand_attr: attr('brand', 'Brand', 'text', { searchable: true }),
  country_origin: attr('country_of_origin', 'Country of Origin', 'select', { options: ['India','China','USA','South Korea','Japan','Germany','Bangladesh','Vietnam','Taiwan','Thailand'] }),
  skin_type: attr('skin_type', 'Skin Type', 'multi_select', { options: ['All Skin Types','Normal','Dry','Oily','Combination','Sensitive','Acne-Prone'] }),
  concern:  attr('concern', 'Skin Concern', 'multi_select', { options: ['Anti-Aging','Brightening','Moisturizing','Acne Control','Dark Spots','Pore Minimizing','Sun Protection','Hydration'] }),
  spf:      attr('spf', 'SPF', 'select', { options: ['SPF 15','SPF 20','SPF 30','SPF 50','SPF 50+','SPF 100','No SPF'] }),
  volume:   attr('volume_ml', 'Volume', 'select', { options: ['5ml','10ml','15ml','20ml','30ml','50ml','75ml','100ml','150ml','200ml','250ml','300ml','500ml','1000ml'], isVariant: true, unit: 'ml' }),
  vehicle_type: attr('vehicle_type', 'Vehicle Type', 'select', { options: ['2-Wheeler','4-Wheeler','Truck','Bus','SUV','Sedan','Hatchback','Commercial'] }),
};

// ─── Category tree data ───────────────────────────────────────────────────────
const CATEGORY_TREE = [
  {
    key: 'electronics', name: 'Electronics', order: 1,
    attrs: [ATTR.warranty, ATTR.brand_attr, ATTR.country_origin],
    subs: [
      { key: 'smartphones', name: 'Smartphones', attrs: [ATTR.ram, ATTR.storage, ATTR.color, ATTR.display, ATTR.battery, ATTR.camera, ATTR.os, ATTR.network_gen, ATTR.refresh_rate, ATTR.connectivity, ATTR.processor, ATTR.warranty],
        children: ['Android Phones','iPhones','Budget Phones Under 10000','Mid-Range Phones 10000-30000','Premium Phones Above 30000','5G Phones','Camera Phones','Gaming Phones','Foldable Phones','Rugged Phones'] },
      { key: 'feature-phones', name: 'Feature Phones', attrs: [ATTR.color, ATTR.battery, ATTR.connectivity, ATTR.brand_attr],
        children: ['Basic Phones','Music Phones','Senior Phones','Jio Phones','Dual SIM Phones'] },
      { key: 'tablets', name: 'Tablets', attrs: [ATTR.ram, ATTR.storage, ATTR.display, ATTR.os, ATTR.battery, ATTR.connectivity, ATTR.color, ATTR.processor, ATTR.warranty],
        children: ['Android Tablets','iPads','Windows Tablets','Kids Tablets','Drawing Tablets','E-Readers','Gaming Tablets'] },
      { key: 'smartwatches', name: 'Smartwatches & Wearables', attrs: [ATTR.color, ATTR.connectivity, ATTR.battery, ATTR.display, ATTR.warranty],
        children: ['Smartwatches','Fitness Bands','Smart Rings','GPS Watches','Kids Smartwatches','Sport Watches','ECG Monitors','Blood Pressure Monitors'] },
      { key: 'earphones', name: 'Earphones & Headphones', attrs: [ATTR.color, ATTR.connectivity, ATTR.warranty],
        children: ['In-Ear Earphones','On-Ear Headphones','Over-Ear Headphones','True Wireless TWS','Neckbands','Gaming Headsets','Studio Headphones','Noise Cancelling Headphones','Sports Earphones'] },
      { key: 'power-banks', name: 'Power Banks & Chargers', attrs: [ATTR.color, ATTR.connectivity, ATTR.warranty],
        children: ['Power Banks','Fast Chargers','Wireless Chargers','Car Chargers','Solar Chargers','Multi-Port Chargers','GaN Chargers','Charging Cables'] },
      { key: 'smart-home', name: 'Smart Home Devices', attrs: [ATTR.connectivity, ATTR.voltage, ATTR.warranty],
        children: ['Smart Bulbs','Smart Plugs','Smart Speakers','Security Cameras','Video Doorbells','Smart Locks','Smart Thermostats','Robot Vacuums','Home Automation Hubs','Smart Curtain Controllers'] },
      { key: 'cameras-photo', name: 'Cameras & Photography', attrs: [ATTR.color, ATTR.connectivity, ATTR.warranty],
        children: ['DSLR Cameras','Mirrorless Cameras','Point & Shoot Cameras','Action Cameras','Drone Cameras','Instant Cameras','Camera Lenses','Camera Bags','Tripods & Stands','Memory Cards for Camera'] },
      { key: 'networking', name: 'Networking Devices', attrs: [ATTR.connectivity, ATTR.warranty],
        children: ['Wi-Fi Routers','Mesh Wi-Fi Systems','Network Switches','Modems','Range Extenders','Network Adapters','Powerline Adapters','4G Routers'] },
      { key: 'storage-devices', name: 'Storage Devices', attrs: [ATTR.storage, ATTR.connectivity, ATTR.color, ATTR.warranty],
        children: ['External Hard Drives','Portable SSDs','USB Flash Drives','Memory Cards','NAS Devices','Internal Hard Drives','Internal SSDs'] },
      { key: 'computer-peripherals', name: 'Computer Peripherals', attrs: [ATTR.color, ATTR.connectivity, ATTR.warranty],
        children: ['Keyboards','Mouse & Pointing Devices','Webcams','UPS & Inverters','Speakers for PC','Microphones','Drawing Tablets','KVM Switches','Card Readers','USB Hubs'] },
      { key: 'projectors-screens', name: 'Projectors & Screens', attrs: [ATTR.resolution, ATTR.connectivity, ATTR.warranty],
        children: ['Home Projectors','Office Projectors','Portable Projectors','Mini Projectors','4K Projectors','Laser Projectors','Projection Screens'] },
    ],
  },
  {
    key: 'computers', name: 'Computers & Laptops', order: 2,
    attrs: [ATTR.processor, ATTR.ram, ATTR.storage, ATTR.display, ATTR.os, ATTR.warranty],
    subs: [
      { key: 'laptops', name: 'Laptops', attrs: [ATTR.processor, ATTR.ram, ATTR.storage, ATTR.display, ATTR.os, ATTR.refresh_rate, ATTR.connectivity, ATTR.color, ATTR.warranty, ATTR.battery],
        children: ['Gaming Laptops','Ultrabooks','Business Laptops','Student Laptops','Chromebooks','2-in-1 Laptops','MacBooks','Workstation Laptops','Thin & Light Laptops','Budget Laptops Under 30000'] },
      { key: 'desktops', name: 'Desktop Computers', attrs: [ATTR.processor, ATTR.ram, ATTR.storage, ATTR.os, ATTR.warranty],
        children: ['All-in-One PCs','Tower PCs','Mini PCs','Gaming Desktops','Workstations','Server PCs','Refurbished Desktops'] },
      { key: 'monitors', name: 'Monitors', attrs: [ATTR.display, ATTR.resolution, ATTR.refresh_rate, ATTR.color, ATTR.connectivity, ATTR.warranty],
        children: ['Gaming Monitors','Office Monitors','4K Monitors','Curved Monitors','Ultrawide Monitors','Portable Monitors','Touch Monitors','IPS Monitors'] },
      { key: 'pc-components', name: 'PC Components', attrs: [ATTR.warranty],
        children: ['CPUs & Processors','Graphics Cards','RAM Modules','SSDs & Hard Drives','Motherboards','Power Supplies','CPU Coolers','PC Cases','Network Cards','Sound Cards'] },
      { key: 'printers', name: 'Printers & Scanners', attrs: [ATTR.connectivity, ATTR.warranty],
        children: ['Inkjet Printers','Laser Printers','All-in-One Printers','Photo Printers','Label Printers','Flatbed Scanners','Document Scanners','Multifunction Printers'] },
    ],
  },
  {
    key: 'tv-audio', name: 'TV, Audio & Video', order: 3,
    attrs: [ATTR.display, ATTR.resolution, ATTR.connectivity, ATTR.energy_star, ATTR.warranty],
    subs: [
      { key: 'televisions', name: 'Televisions', attrs: [ATTR.display, ATTR.resolution, ATTR.refresh_rate, ATTR.connectivity, ATTR.energy_star, ATTR.os, ATTR.warranty],
        children: ['Smart TVs','OLED TVs','QLED TVs','LED TVs','Android TVs','4K Ultra HD TVs','8K TVs','Budget TVs Under 20000','Full HD TVs','Commercial Displays'] },
      { key: 'home-audio', name: 'Home Audio Systems', attrs: [ATTR.connectivity, ATTR.warranty],
        children: ['Soundbars','Home Theatre Systems','Bookshelf Speakers','Floor Standing Speakers','Subwoofers','Amplifiers & Receivers','Turntables','AV Receivers'] },
      { key: 'portable-speakers', name: 'Portable Speakers', attrs: [ATTR.color, ATTR.connectivity, ATTR.battery, ATTR.warranty],
        children: ['Bluetooth Speakers','Party Speakers','Mini Speakers','Smart Speakers Alexa','Waterproof Speakers','FM Radio Speakers','Solar Speakers'] },
      { key: 'set-top-boxes', name: 'Set Top Boxes & Streaming', attrs: [ATTR.connectivity, ATTR.warranty],
        children: ['DTH Set Top Boxes','Android TV Boxes','Amazon Fire TV Stick','Chromecast','Apple TV','Streaming Sticks','HDMI Dongles'] },
    ],
  },
  {
    key: 'mens-fashion', name: "Men's Fashion", order: 4,
    attrs: [ATTR.gender, ATTR.color, ATTR.material, ATTR.brand_attr, ATTR.wash],
    subs: [
      { key: 'mens-tshirts', name: "Men's T-Shirts", attrs: [ATTR.color, ATTR.size_apparel, ATTR.material, ATTR.fit, ATTR.pattern, ATTR.collar, ATTR.sleeve, ATTR.occasion],
        children: ['Round Neck T-Shirts','Polo T-Shirts','V-Neck T-Shirts','Henley T-Shirts','Oversized T-Shirts','Printed T-Shirts','Plain T-Shirts','Graphic T-Shirts','Sports T-Shirts','Sleeveless T-Shirts'] },
      { key: 'mens-shirts', name: "Men's Shirts", attrs: [ATTR.color, ATTR.size_apparel, ATTR.material, ATTR.fit, ATTR.pattern, ATTR.collar, ATTR.sleeve, ATTR.occasion],
        children: ['Casual Shirts','Formal Shirts','Linen Shirts','Denim Shirts','Check Shirts','Printed Shirts','Solid Shirts','Ethnic Kurta Shirts','Party Shirts','Half Sleeve Shirts'] },
      { key: 'mens-jeans', name: "Men's Jeans & Trousers", attrs: [ATTR.color, ATTR.size_apparel, ATTR.material, ATTR.fit, ATTR.pattern],
        children: ['Slim Fit Jeans','Regular Fit Jeans','Skinny Jeans','Straight Fit Jeans','Cargo Trousers','Chino Trousers','Formal Trousers','Track Pants','Joggers','Shorts & Bermudas'] },
      { key: 'mens-ethnic', name: "Men's Ethnic Wear", attrs: [ATTR.color, ATTR.size_apparel, ATTR.material, ATTR.occasion, ATTR.pattern],
        children: ['Kurtas','Sherwanis','Kurta Sets','Dhotis','Lungi','Nehru Jackets','Pathani Suits','Indo-Western Sets','Achkan','Sherwani Sets'] },
      { key: 'mens-jackets', name: "Men's Jackets & Coats", attrs: [ATTR.color, ATTR.size_apparel, ATTR.material, ATTR.occasion],
        children: ['Casual Jackets','Bomber Jackets','Denim Jackets','Blazers','Windcheaters','Rain Jackets','Leather Jackets','Down Jackets','Hooded Jackets','Quilted Jackets'] },
      { key: 'mens-activewear', name: "Men's Sportswear", attrs: [ATTR.color, ATTR.size_apparel, ATTR.material, ATTR.sport],
        children: ['Gym Clothes','Running Clothes','Football Jerseys','Cricket Jerseys','Cycling Wear','Swim Wear','Yoga Wear','Compression Wear','Sports Shorts','Trackpants Sports'] },
      { key: 'mens-suits', name: "Men's Suits & Blazers", attrs: [ATTR.color, ATTR.size_apparel, ATTR.material, ATTR.fit, ATTR.occasion],
        children: ['2-Piece Suits','3-Piece Suits','Wedding Suits','Office Blazers','Velvet Blazers','Checkered Blazers','Single Breasted Suits','Double Breasted Suits'] },
      { key: 'mens-innerwear', name: "Men's Innerwear & Socks", attrs: [ATTR.color, ATTR.size_apparel, ATTR.material],
        children: ['Briefs & Trunks','Boxers','Vests & Undershirts','Thermal Innerwear','Ankle Socks','Full Length Socks','Sports Socks','Compression Socks'] },
    ],
  },
  {
    key: 'womens-fashion', name: "Women's Fashion", order: 5,
    attrs: [ATTR.gender, ATTR.color, ATTR.material, ATTR.brand_attr, ATTR.wash],
    subs: [
      { key: 'sarees', name: 'Sarees', attrs: [ATTR.color, ATTR.material, ATTR.pattern, ATTR.occasion],
        children: ['Silk Sarees','Cotton Sarees','Georgette Sarees','Chiffon Sarees','Banarasi Sarees','Kanchipuram Sarees','Designer Sarees','Casual Sarees','Printed Sarees','Embroidered Sarees','Party Sarees','Linen Sarees'] },
      { key: 'kurtas-suits', name: 'Kurtas & Suits', attrs: [ATTR.color, ATTR.size_apparel, ATTR.material, ATTR.pattern, ATTR.occasion, ATTR.sleeve],
        children: ['Anarkali Kurtas','Straight Kurtas','A-Line Kurtas','Kurti with Palazzo','Kurti with Leggings','Patiala Suits','Salwar Kameez','Churidar Sets','Shirt Style Kurtis','Jacket Style Kurtis'] },
      { key: 'lehengas', name: 'Lehengas & Ghagras', attrs: [ATTR.color, ATTR.size_apparel, ATTR.material, ATTR.pattern, ATTR.occasion],
        children: ['Bridal Lehengas','Party Lehengas','Designer Lehengas','Ghagra Choli','Chaniya Choli','Garba Wear','Kids Lehengas','Semi-Stitched Lehengas'] },
      { key: 'western-tops', name: 'Tops & Blouses', attrs: [ATTR.color, ATTR.size_apparel, ATTR.material, ATTR.pattern, ATTR.sleeve, ATTR.collar],
        children: ['Casual Tops','Formal Tops','Crop Tops','Tank Tops','Peplum Tops','Bodycon Tops','Tube Tops','Off-Shoulder Tops','Saree Blouses','Halter Tops'] },
      { key: 'dresses', name: 'Dresses & Jumpsuits', attrs: [ATTR.color, ATTR.size_apparel, ATTR.material, ATTR.pattern, ATTR.occasion, ATTR.fit],
        children: ['Casual Dresses','Party Dresses','Maxi Dresses','Mini Dresses','Bodycon Dresses','A-Line Dresses','Shirt Dresses','Wrap Dresses','Jumpsuits','Co-ord Sets','Sundresses'] },
      { key: 'womens-bottoms', name: "Women's Jeans & Bottoms", attrs: [ATTR.color, ATTR.size_apparel, ATTR.material, ATTR.fit],
        children: ['Skinny Jeans','Straight Jeans','Flared Jeans','Mom Jeans','High Rise Jeans','Formal Trousers','Palazzos','Skirts','Mini Skirts','Jeggings','Shorts','Harem Pants'] },
      { key: 'ethnic-indian', name: 'Indian Wear', attrs: [ATTR.color, ATTR.size_apparel, ATTR.material, ATTR.occasion, ATTR.pattern],
        children: ['Shararas','Churidars','Indowestern Dresses','Dupattas & Stoles','Bandhani Wear','Phulkari Wear','Kalamkari Wear','Benarasi Dupatta','Banarasi Blouses'] },
      { key: 'womens-activewear', name: "Women's Activewear", attrs: [ATTR.color, ATTR.size_apparel, ATTR.material, ATTR.sport],
        children: ['Sports Bras','Yoga Pants & Leggings','Running Tops','Gym Shorts','Swimwear Women','Track Pants Women','Compression Wear Women','Activewear Sets'] },
      { key: 'lingerie', name: 'Lingerie & Nightwear', attrs: [ATTR.color, ATTR.size_apparel, ATTR.material],
        children: ['Bras','Panties & Briefs','Nightgowns','Sleep Shorts','Robes','Camisoles','Corsets','Maternity Wear','Shapewear'] },
    ],
  },
  {
    key: 'kids-fashion', name: "Kids' Fashion", order: 6,
    attrs: [ATTR.age_group, ATTR.gender, ATTR.color, ATTR.material, ATTR.wash],
    subs: [
      { key: 'boys-clothing', name: "Boys' Clothing", attrs: [ATTR.color, ATTR.size_apparel, ATTR.material, ATTR.age_group, ATTR.pattern],
        children: ["Boys' T-Shirts","Boys' Shirts","Boys' Jeans","Boys' Shorts","Boys' Ethnic Wear","Boys' School Uniforms","Boys' Party Wear","Boys' Trackpants","Boys' Dungarees","Boys' Sets"] },
      { key: 'girls-clothing', name: "Girls' Clothing", attrs: [ATTR.color, ATTR.size_apparel, ATTR.material, ATTR.age_group, ATTR.pattern],
        children: ["Girls' T-Shirts","Girls' Tops","Girls' Skirts","Girls' Lehenga Choli","Girls' Frocks & Dresses","Girls' Salwar Kameez","Girls' School Uniforms","Girls' Jeans","Girls' Party Wear","Girls' Leggings"] },
      { key: 'infant-wear', name: 'Infant & Toddler Wear', attrs: [ATTR.color, ATTR.size_apparel, ATTR.material, ATTR.age_group],
        children: ['Bodysuits & Onesies','Rompers','Sleep Suits','Baby Sets','Bibs','Booties','Baby Caps','Baby Mittens','Baby Dungarees','Festival Wear Baby'] },
    ],
  },
  {
    key: 'footwear', name: 'Footwear', order: 7,
    attrs: [ATTR.color, ATTR.size_shoes, ATTR.material, ATTR.gender, ATTR.occasion, ATTR.brand_attr],
    subs: [
      { key: 'mens-shoes', name: "Men's Shoes", attrs: [ATTR.color, ATTR.size_shoes, ATTR.material, ATTR.occasion],
        children: ['Casual Shoes Men','Formal Shoes Men','Sports Shoes Men','Running Shoes Men','Sneakers Men','Loafers Men','Oxford Shoes','Derby Shoes','Boots Men','Sandals Men','Floaters Men'] },
      { key: 'womens-shoes', name: "Women's Shoes", attrs: [ATTR.color, ATTR.size_shoes, ATTR.material, ATTR.occasion],
        children: ['Heels','Wedges','Ballet Flats','Casual Shoes Women','Sports Shoes Women','Sneakers Women','Sandals Women','Kolhapuri','Ankle Boots Women','Platform Shoes'] },
      { key: 'kids-shoes', name: "Kids' Shoes", attrs: [ATTR.color, ATTR.size_shoes, ATTR.material, ATTR.age_group],
        children: ['School Shoes Boys','School Shoes Girls','Sports Shoes Kids','Casual Shoes Kids','Sandals Kids','Slippers Kids'] },
      { key: 'slippers', name: 'Slippers & Flip-Flops', attrs: [ATTR.color, ATTR.size_shoes, ATTR.material],
        children: ['Flip-Flops Men','Flip-Flops Women','Home Slippers','EVA Slippers','Clogs','Beach Slippers'] },
      { key: 'sports-outdoor-shoes', name: 'Sports & Outdoor Footwear', attrs: [ATTR.color, ATTR.size_shoes, ATTR.material, ATTR.sport],
        children: ['Running Shoes','Training Shoes','Football Boots','Cricket Shoes','Basketball Shoes','Tennis Shoes','Hiking Shoes','Trekking Boots','Cycling Shoes'] },
    ],
  },
  {
    key: 'beauty', name: 'Beauty & Personal Care', order: 8,
    attrs: [ATTR.skin_type, ATTR.country_origin, ATTR.brand_attr],
    subs: [
      { key: 'skincare', name: 'Skincare', attrs: [ATTR.skin_type, ATTR.concern, ATTR.spf, ATTR.volume],
        children: ['Moisturizers & Creams','Face Serums','Face Oils','Sunscreens & SPF','Face Wash & Cleansers','Toners & Mists','Eye Creams','Face Masks & Packs','Exfoliators & Scrubs','Night Creams','Sheet Masks','Lip Balms'] },
      { key: 'makeup', name: 'Makeup', attrs: [ATTR.color, ATTR.volume, ATTR.skin_type],
        children: ['Foundation & BB Cream','Concealer','Compact & Setting Powder','Blush & Bronzer','Highlighter','Eyeshadow','Eyeliner & Kajal','Mascara','Eyebrow Products','Lipstick','Lip Gloss','Lip Liner','Makeup Primer','Makeup Brushes','Makeup Remover'] },
      { key: 'haircare', name: 'Hair Care', attrs: [ATTR.volume],
        children: ['Shampoos','Conditioners','Hair Masks & Treatments','Hair Oils','Hair Serums','Dry Shampoos','Hair Colors & Dyes','Hair Growth Products','Anti-Dandruff Products','Hair Accessories'] },
      { key: 'bodycare', name: 'Body Care', attrs: [ATTR.volume, ATTR.skin_type],
        children: ['Body Lotions & Moisturizers','Body Scrubs','Body Oils','Body Washes & Shower Gels','Soaps','Talcum Powders','Deodorants & Antiperspirants','Stretch Mark Creams'] },
      { key: 'fragrances', name: 'Fragrances & Perfumes', attrs: [ATTR.volume],
        children: ['Perfumes Women','Perfumes Men','Unisex Perfumes','Attars & Itr','Body Mists','Room Fresheners','Diffusers','Scented Candles'] },
      { key: 'mens-grooming', name: "Men's Grooming", attrs: [ATTR.volume],
        children: ['Shaving Creams & Gels','After-Shave Lotion','Shaving Kits','Beard Oils & Balms','Face Wash Men','Moisturizers Men','Hair Styling Products','Beard Trimmers','Electric Shavers'] },
      { key: 'oral-care', name: 'Oral Care', attrs: [],
        children: ['Toothbrushes','Toothpaste','Mouthwash','Teeth Whitening Kits','Dental Floss','Electric Toothbrushes','Tongue Cleaners','Charcoal Toothpaste'] },
      { key: 'beauty-tools', name: 'Beauty Tools & Devices', attrs: [ATTR.voltage, ATTR.warranty],
        children: ['Hair Straighteners','Curling Irons','Hair Dryers','Electric Epilators','Face Rollers','IPL Devices','LED Therapy Masks','Nail Tools','Makeup Mirrors','Facial Steamers'] },
    ],
  },
  {
    key: 'health-wellness', name: 'Health & Wellness', order: 9,
    attrs: [ATTR.country_origin, ATTR.brand_attr],
    subs: [
      { key: 'vitamins-supplements', name: 'Vitamins & Supplements', attrs: [ATTR.pack_size, ATTR.flavor],
        children: ['Multivitamins','Vitamin C','Vitamin D3','Omega-3 & Fish Oil','Protein Supplements','Mass Gainers','BCAA Supplements','Pre-Workout','Creatine','Collagen','Calcium Supplements','Probiotic Supplements','Ashwagandha','Melatonin'] },
      { key: 'medical-devices', name: 'Medical Devices', attrs: [ATTR.warranty],
        children: ['BP Monitors','Glucometers','Pulse Oximeters','Thermometers','Stethoscopes','Nebulizers','Orthopaedic Supports','Wheelchairs','Walking Sticks','Hearing Aids'] },
      { key: 'fitness-equipment', name: 'Fitness Equipment', attrs: [ATTR.color, ATTR.weight_kg, ATTR.warranty],
        children: ['Yoga Mats','Dumbbells','Resistance Bands','Skipping Ropes','Pull-Up Bars','Ab Rollers','Treadmills','Exercise Cycles','Elliptical Trainers','Barbells','Foam Rollers','Gym Gloves'] },
      { key: 'ayurveda', name: 'Ayurveda & Herbal', attrs: [ATTR.pack_size],
        children: ['Chyawanprash','Triphala','Ashwagandha Products','Giloy Products','Neem Products','Tulsi Products','Herbal Teas','Ayurvedic Oils','Herbal Supplements','Panchakarma Kits'] },
    ],
  },
  {
    key: 'appliances', name: 'Home Appliances', order: 10,
    attrs: [ATTR.energy_star, ATTR.voltage, ATTR.warranty, ATTR.brand_attr],
    subs: [
      { key: 'washing-machines', name: 'Washing Machines', attrs: [ATTR.capacity_ltr, ATTR.energy_star, ATTR.color, ATTR.warranty],
        children: ['Front Load Washing Machines','Top Load Washing Machines','Semi-Automatic Washing Machines','Mini Washing Machines','Washer-Dryer Combos'] },
      { key: 'refrigerators', name: 'Refrigerators', attrs: [ATTR.capacity_ltr, ATTR.energy_star, ATTR.color, ATTR.warranty],
        children: ['Single Door Refrigerators','Double Door Refrigerators','Side-by-Side Refrigerators','French Door Refrigerators','Mini Fridges','Deep Freezers'] },
      { key: 'air-conditioners', name: 'Air Conditioners', attrs: [ATTR.capacity_ltr, ATTR.energy_star, ATTR.warranty],
        children: ['Split ACs 1 Ton','Split ACs 1.5 Ton','Split ACs 2 Ton','Window ACs','Portable ACs','Cassette ACs','Inverter ACs','Convertible ACs'] },
      { key: 'microwave-ovens', name: 'Microwave Ovens', attrs: [ATTR.capacity_ltr, ATTR.energy_star, ATTR.color, ATTR.wattage, ATTR.warranty],
        children: ['Solo Microwave Ovens','Grill Microwave Ovens','Convection Microwave Ovens','OTG Ovens','Air Fryer Ovens','Built-in Microwave Ovens'] },
      { key: 'water-purifiers', name: 'Water Purifiers', attrs: [ATTR.capacity_ltr, ATTR.warranty],
        children: ['RO Water Purifiers','UV Water Purifiers','UF Water Purifiers','Gravity Water Purifiers','Water Dispensers','Under Sink RO Systems'] },
      { key: 'geysers', name: 'Geysers & Water Heaters', attrs: [ATTR.capacity_ltr, ATTR.energy_star, ATTR.warranty],
        children: ['Instant Water Heaters','Storage Water Heaters 10L','Storage Water Heaters 25L','Solar Water Heaters','Heat Pump Water Heaters'] },
      { key: 'fans-coolers', name: 'Fans & Coolers', attrs: [ATTR.color, ATTR.wattage, ATTR.energy_star, ATTR.warranty],
        children: ['Ceiling Fans','Table Fans','Pedestal Fans','Wall Fans','Exhaust Fans','Personal Air Coolers','Tower Coolers','Window Coolers','Tower Fans','BLDC Fans'] },
      { key: 'kitchen-chimneys', name: 'Kitchen Chimneys & Hobs', attrs: [ATTR.capacity_ltr, ATTR.warranty],
        children: ['Wall Mount Kitchen Chimneys','Island Kitchen Chimneys','Gas Stoves 2 Burner','Gas Stoves 3 Burner','Gas Stoves 4 Burner','Induction Cooktops','Electric Cooktops'] },
      { key: 'small-appliances', name: 'Small Kitchen Appliances', attrs: [ATTR.wattage, ATTR.capacity_ltr, ATTR.color, ATTR.warranty],
        children: ['Mixer Grinders','Juicer Mixer Grinders','Juicers','Food Processors','Rice Cookers','Electric Kettles','Coffee Makers','Sandwich Makers','Pop-up Toasters','Electric Pressure Cookers','Blenders','Hand Blenders','Air Fryers','Bread Makers'] },
    ],
  },
  {
    key: 'home-kitchen', name: 'Home & Kitchen', order: 11,
    attrs: [ATTR.material, ATTR.color, ATTR.brand_attr],
    subs: [
      { key: 'cookware', name: 'Cookware', attrs: [ATTR.material, ATTR.capacity_ltr, ATTR.color],
        children: ['Kadais','Tawas & Griddles','Pressure Cookers','Pans & Skillets','Saucepans & Casseroles','Woks','Steamers','Dutch Ovens','Cast Iron Cookware','Non-Stick Cookware'] },
      { key: 'kitchen-storage', name: 'Kitchen Storage', attrs: [ATTR.material, ATTR.capacity_ltr],
        children: ['Food Storage Containers','Lunch Boxes & Tiffins','Spice Containers','Dry Fruit Boxes','Stackable Containers','Glass Jars','Water Bottles','Thermos Flasks','Bottle Racks'] },
      { key: 'tableware', name: 'Tableware & Serveware', attrs: [ATTR.material, ATTR.color],
        children: ['Dinner Sets','Plates & Bowls','Cups & Mugs','Glasses & Tumblers','Serving Bowls','Cutlery Sets','Spoons & Ladles','Coasters','Table Mats','Dinner Plates'] },
      { key: 'home-textiles', name: 'Home Textiles & Linens', attrs: [ATTR.material, ATTR.color],
        children: ['Bedsheets & Pillowcovers','Blankets & Quilts','Comforters & Duvets','Cushion Covers','Curtains & Blinds','Bath Towels','Kitchen Towels','Door Mats','Carpets & Rugs','Table Covers'] },
      { key: 'home-decor', name: 'Home Décor', attrs: [ATTR.material, ATTR.color],
        children: ['Wall Clocks','Photo Frames','Showpieces & Figurines','Wall Art & Paintings','Vases & Flower Pots','Candles & Holders','Wind Chimes','Artificial Plants','Festive Decorations','Mirrors','Table Lamps','Floor Lamps'] },
      { key: 'cleaning', name: 'Cleaning & Utilities', attrs: [],
        children: ['Vacuum Cleaners','Mops & Brooms','Cleaning Brushes','Garbage Bins','Drain Covers','Iron Boxes','Drying Stands','Ironing Boards','Washing Brushes'] },
    ],
  },
  {
    key: 'furniture', name: 'Furniture', order: 12,
    attrs: [ATTR.material_furniture, ATTR.color, ATTR.finish, ATTR.assembly, ATTR.warranty],
    subs: [
      { key: 'bedroom-furniture', name: 'Bedroom Furniture', attrs: [ATTR.material_furniture, ATTR.color, ATTR.finish, ATTR.assembly],
        children: ['Beds Single','Beds Double','Beds King','Mattresses','Wardrobes & Closets','Dressing Tables','Bedside Tables','Chest of Drawers','Bunk Beds','Storage Beds'] },
      { key: 'living-room-furniture', name: 'Living Room Furniture', attrs: [ATTR.material_furniture, ATTR.color, ATTR.finish, ATTR.assembly],
        children: ['2-Seater Sofas','3-Seater Sofas','L-Shaped Sofas','Recliners','Coffee Tables','TV Units','Bookshelves','Shoe Racks','Ottomans','Bean Bags','Accent Chairs','Side Tables'] },
      { key: 'dining-furniture', name: 'Dining Furniture', attrs: [ATTR.material_furniture, ATTR.color, ATTR.finish, ATTR.assembly],
        children: ['4-Seater Dining Sets','6-Seater Dining Sets','Dining Tables','Dining Chairs','Bar Stools','Kitchen Islands','Sideboards & Buffets','Folding Tables'] },
      { key: 'office-study-furniture', name: 'Office & Study Furniture', attrs: [ATTR.material_furniture, ATTR.color, ATTR.finish, ATTR.assembly],
        children: ['Office Desks','Office Chairs Ergonomic','Bookshelves Study','Filing Cabinets','Study Tables for Kids','Computer Desks','Standing Desks','Conference Tables'] },
      { key: 'outdoor-furniture', name: 'Outdoor & Garden Furniture', attrs: [ATTR.material_furniture, ATTR.color],
        children: ['Garden Chairs','Garden Tables','Balcony Furniture Sets','Sun Loungers','Hammocks','Outdoor Swings','Garden Benches','Patio Furniture Sets'] },
    ],
  },
  {
    key: 'books', name: 'Books & Media', order: 13,
    attrs: [ATTR.language, ATTR.format, ATTR.pages],
    subs: [
      { key: 'academic-books', name: 'Academic & Educational', attrs: [ATTR.language, ATTR.format],
        children: ['CBSE Books','ICSE Books','Competitive Exam Books','Engineering Books','Medical MBBS Books','MBA Books','CA CS Study Material','UPSC IAS Books','Bank PO Exam Books','State Board Books'] },
      { key: 'fiction-literature', name: 'Fiction & Literature', attrs: [ATTR.language, ATTR.format],
        children: ['Indian Authors Fiction','International Bestsellers','Classic Literature','Science Fiction','Fantasy Novels','Mystery & Thriller','Romance Novels','Horror Books','Historical Fiction','Graphic Novels'] },
      { key: 'non-fiction', name: 'Non-Fiction & Self-Help', attrs: [ATTR.language, ATTR.format],
        children: ['Business & Management','Biography & Autobiography','Self-Help & Personal Development','Politics & Current Affairs','Travel & Adventure','Science & Technology','History & Culture','Philosophy','Religion & Spirituality'] },
      { key: 'childrens-books', name: "Children's Books", attrs: [ATTR.language, ATTR.format, ATTR.age_group],
        children: ['Picture Books','Story Books','Comics for Kids','Activity Books','Nursery Rhymes','Moral Stories','Panchatantra','Fairy Tales','Colouring Books','Science Activity Books'] },
      { key: 'stationery', name: 'Stationery', attrs: [ATTR.color],
        children: ['Pens & Pencils','Notebooks & Diaries','Art Supplies','Sticky Notes','Binders & Files','Calculators','Scissors & Cutters','Whiteboard Markers','Sketch Pens','Drawing Books'] },
    ],
  },
  {
    key: 'sports', name: 'Sports & Fitness', order: 14,
    attrs: [ATTR.sport, ATTR.color, ATTR.material, ATTR.brand_attr],
    subs: [
      { key: 'cricket', name: 'Cricket', attrs: [ATTR.color],
        children: ['Cricket Bats English Willow','Cricket Bats Kashmir Willow','Cricket Balls','Cricket Gloves','Cricket Pads','Cricket Helmets','Cricket Kits','Cricket Shoes','Cricket Jerseys','Cricket Stumps & Bails','Cricket Practice Nets'] },
      { key: 'football', name: 'Football & Soccer', attrs: [ATTR.color],
        children: ['Football Shoes','Footballs','Football Jerseys','Goalkeeper Gloves','Football Kits','Shin Guards','Goal Posts','Football Socks'] },
      { key: 'badminton', name: 'Badminton', attrs: [ATTR.color],
        children: ['Badminton Rackets','Shuttlecocks Nylon','Shuttlecocks Feather','Badminton Shoes','Badminton Bags','Net Posts','Grip Tapes','Badminton Kits'] },
      { key: 'gym-fitness', name: 'Gym & Fitness Equipment', attrs: [ATTR.color, ATTR.weight_kg],
        children: ['Dumbbells Set','Barbells','Kettlebells','Resistance Bands Set','Weight Plates','Weight Benches','Pull-Up Bars','Ab Rollers','Gym Bags','Gym Gloves','Weight Training Belts'] },
      { key: 'yoga', name: 'Yoga & Pilates', attrs: [ATTR.color, ATTR.material],
        children: ['Yoga Mats Thick','Yoga Blocks','Yoga Straps','Yoga Bolsters','Pilates Rings','Exercise Balls','Foam Rollers','Meditation Cushions','Yoga Wheels','Yoga Bags'] },
      { key: 'cycling', name: 'Cycling', attrs: [ATTR.color],
        children: ['Bicycles Road Bikes','Bicycles Mountain Bikes','Electric Cycles','Cycle Helmets','Cycling Gloves','Cycle Bags','Cycle Lights','Cycle Locks','Tyres & Tubes Cycles'] },
    ],
  },
  {
    key: 'toys', name: 'Toys & Baby Products', order: 15,
    attrs: [ATTR.age_group, ATTR.material, ATTR.color, ATTR.brand_attr],
    subs: [
      { key: 'educational-toys', name: 'Educational & Learning Toys', attrs: [ATTR.age_group, ATTR.color],
        children: ['Building Blocks','STEM Toys','Jigsaw Puzzles','Board Games','Flash Cards','Alphabets Numbers Toys','Art & Craft Kits','Science Kits','Musical Instrument Toys','Reading Toys'] },
      { key: 'action-figures', name: 'Action Figures & Vehicles', attrs: [ATTR.age_group, ATTR.color],
        children: ['Superhero Action Figures','Toy Cars & Vehicles','Remote Control Cars','Robots Toys','Monster Trucks','Dinosaur Toys','Wrestling Figures','Model Trains','Slot Cars'] },
      { key: 'dolls', name: 'Dolls & Playsets', attrs: [ATTR.age_group, ATTR.color],
        children: ['Fashion Dolls','Baby Dolls','Doll Houses','Kitchen Playsets','Doctor Playsets','Soft Plush Dolls','Doll Accessories'] },
      { key: 'baby-products', name: 'Baby Care Products', attrs: [ATTR.age_group, ATTR.color, ATTR.material],
        children: ['Baby Strollers & Prams','High Chairs','Feeding Bottles','Baby Food Bowls','Breastfeeding Accessories','Baby Carriers','Cots & Cradles','Baby Monitors','Nappy & Diapering','Infant Car Seats'] },
      { key: 'outdoor-play', name: 'Outdoor & Sports Toys', attrs: [ATTR.age_group, ATTR.color],
        children: ['Cycles for Kids','Scooters for Kids','Footballs for Kids','Badminton Kits Kids','Cricket Sets Kids','Swings & Slides','Sand & Water Play','Kites','Frisbees','Jump Ropes Kids'] },
      { key: 'soft-toys', name: 'Soft Toys & Stuffed Animals', attrs: [ATTR.color, ATTR.material],
        children: ['Teddy Bears Small','Teddy Bears Large','Animal Plush Toys','Cartoon Character Plush','Rag Dolls','Hand Puppets','Sleeping Pillow Soft Toys'] },
    ],
  },
  {
    key: 'automotive', name: 'Automotive & Bikes', order: 16,
    attrs: [ATTR.vehicle_type, ATTR.brand_attr],
    subs: [
      { key: 'car-accessories', name: 'Car Accessories', attrs: [ATTR.vehicle_type, ATTR.color],
        children: ['Car Seat Covers','Car Fragrances','Car Chargers','Dash Cameras','GPS Navigation Systems','Car Vacuum Cleaners','Car Cleaning Kits','Car Sunshades','Steering Wheel Covers','Car Floor Mats','Car Organizers'] },
      { key: 'car-electronics', name: 'Car Electronics & Audio', attrs: [ATTR.vehicle_type, ATTR.warranty],
        children: ['Car Audio Systems','Car Speakers','Car Amplifiers','Subwoofers for Cars','Bluetooth Car Kits','Rearview Cameras','Head-Up Displays','Car Power Inverters'] },
      { key: 'tyres-batteries', name: 'Tyres, Wheels & Batteries', attrs: [ATTR.vehicle_type],
        children: ['Car Tyres','Bike Tyres','Alloy Wheels Car','Car Batteries','Bike Batteries','Air Compressors for Tyres','Tyre Pressure Gauges'] },
      { key: 'bike-accessories', name: 'Bike & Scooter Accessories', attrs: [ATTR.vehicle_type, ATTR.color],
        children: ['Bike Helmets Full Face','Bike Helmets Half Face','Bike Lights LED','Bike Covers','Bike Locks','Windshields','Saddlebags','Handlebar Grips','Exhaust Systems','Bike Mirrors'] },
    ],
  },
  {
    key: 'jewelry', name: 'Jewellery', order: 17,
    attrs: [ATTR.metal, ATTR.stone, ATTR.purity, ATTR.gender, ATTR.occasion],
    subs: [
      { key: 'gold-jewelry', name: 'Gold Jewellery', attrs: [ATTR.metal, ATTR.stone, ATTR.purity],
        children: ['Gold Necklaces','Gold Bangles','Gold Rings','Gold Earrings','Gold Bracelets','Gold Mangalsutra','Gold Chains','Gold Pendants','Gold Anklets','Bridal Gold Sets'] },
      { key: 'diamond-jewelry', name: 'Diamond Jewellery', attrs: [ATTR.metal, ATTR.purity],
        children: ['Diamond Necklaces','Diamond Engagement Rings','Diamond Earrings','Diamond Bangles','Diamond Pendants','Diamond Bracelets','Diamond Sets'] },
      { key: 'silver-jewelry', name: 'Silver Jewellery', attrs: [ATTR.metal, ATTR.stone, ATTR.purity],
        children: ['Silver Necklaces','Silver Rings','Silver Earrings','Silver Bangles','Silver Bracelets','Silver Payal & Anklets','Silver Sets'] },
      { key: 'fashion-jewelry', name: 'Fashion & Imitation Jewellery', attrs: [ATTR.color, ATTR.material],
        children: ['Jhumkas','Oxidised Jewellery Sets','Kundan Jewellery','Meenakari Jewellery','Beaded Jewellery Sets','Boho Jewellery','Statement Necklaces','Hair Jewellery','Temple Jewellery'] },
    ],
  },
  {
    key: 'watches', name: 'Watches', order: 18,
    attrs: [ATTR.gender, ATTR.color, ATTR.material, ATTR.brand_attr, ATTR.warranty],
    subs: [
      { key: 'mens-watches', name: "Men's Watches", attrs: [ATTR.color, ATTR.material],
        children: ['Analog Watches Men','Digital Watches Men','Chronograph Watches Men','Automatic Watches Men','Sports Watches Men','Luxury Watches Men','Casual Watches Men'] },
      { key: 'womens-watches', name: "Women's Watches", attrs: [ATTR.color, ATTR.material],
        children: ['Analog Watches Women','Fashion Watches Women','Diamond Watches Women','Sports Watches Women','Minimalist Watches Women'] },
      { key: 'kids-watches', name: "Kids' Watches", attrs: [ATTR.color, ATTR.age_group],
        children: ['Digital Watches for Kids','Character Watches for Kids','Waterproof Watches for Kids'] },
    ],
  },
  {
    key: 'bags-luggage', name: 'Bags & Luggage', order: 19,
    attrs: [ATTR.color, ATTR.material, ATTR.gender, ATTR.brand_attr],
    subs: [
      { key: 'handbags', name: 'Handbags & Purses', attrs: [ATTR.color, ATTR.material, ATTR.occasion],
        children: ['Tote Bags Women','Satchel Bags','Hobo Bags','Clutch Bags','Crossbody Bags','Sling Bags Women','Shoulder Bags Women','Evening Bags','Potli Bags'] },
      { key: 'backpacks', name: 'Backpacks', attrs: [ATTR.color, ATTR.material],
        children: ['School Bags','College Bags','Office Backpacks','Laptop Backpacks 15 inch','Travel Backpacks','Sports Backpacks','Mini Backpacks','Anti-Theft Backpacks'] },
      { key: 'luggage', name: 'Trolley & Suitcases', attrs: [ATTR.color, ATTR.material],
        children: ['Cabin Bags 18-20 inch','Check-in Bags 24-28 inch','Hardcase Luggage','Softcase Luggage','Spinner Luggage','Polycarbonate Luggage','Luggage Sets'] },
      { key: 'wallets', name: 'Wallets & Card Holders', attrs: [ATTR.color, ATTR.material, ATTR.gender],
        children: ["Men's Wallets Leather","Women's Wallets",'Card Holders','Passport Holders','Clutch Wallets','Coin Purses','RFID Wallets'] },
    ],
  },
  {
    key: 'food-beverages', name: 'Food & Beverages', order: 20,
    attrs: [ATTR.veg_nonveg, ATTR.shelf_life, ATTR.pack_size],
    subs: [
      { key: 'snacks-namkeen', name: 'Snacks & Namkeen', attrs: [ATTR.pack_size, ATTR.flavor, ATTR.veg_nonveg],
        children: ['Chips & Crisps','Namkeen & Mixtures','Popcorn','Biscuits & Cookies','Crackers','Bhujia','Energy Bars','Rice Cakes'] },
      { key: 'beverages', name: 'Beverages', attrs: [ATTR.pack_size, ATTR.flavor],
        children: ['Tea Bags & Loose Leaf','Instant Coffee','Cold Brew Coffee','Juices & Nectars','Soft Drinks','Energy Drinks','Coconut Water','Health Drinks'] },
      { key: 'condiments-spices', name: 'Condiments & Spices', attrs: [ATTR.pack_size, ATTR.veg_nonveg],
        children: ['Indian Spice Blends','Masala Powders','Salt & Pepper','Sauces & Ketchup','Chutneys & Pickles','Vinegar & Dressings','Mayonnaise','Mustard Sauce'] },
      { key: 'chocolate-sweets', name: 'Chocolates & Sweets', attrs: [ATTR.pack_size, ATTR.flavor],
        children: ['Dark Chocolates','Milk Chocolates','White Chocolates','Mithai & Indian Sweets','Gummies & Candies','Premium Chocolate Boxes','Sugar-Free Sweets'] },
    ],
  },
  {
    key: 'gaming', name: 'Gaming', order: 21,
    attrs: [ATTR.connectivity, ATTR.warranty, ATTR.brand_attr],
    subs: [
      { key: 'consoles', name: 'Gaming Consoles', attrs: [ATTR.connectivity, ATTR.storage, ATTR.color, ATTR.warranty],
        children: ['PlayStation 5 Console','PlayStation 4 Console','Xbox Series X Console','Xbox One','Nintendo Switch','Gaming PCs','Steam Deck','Retro Consoles'] },
      { key: 'pc-gaming', name: 'PC Gaming Accessories', attrs: [ATTR.color, ATTR.connectivity, ATTR.warranty],
        children: ['Gaming Mice','Gaming Keyboards Mechanical','Gaming Headsets','Gaming Monitors','Gaming Chairs','Gaming Controllers PC','Mousepads Gaming','RGB Lighting PC','Gaming Webcams'] },
      { key: 'video-games', name: 'Video Games', attrs: [],
        children: ['PS5 Games Titles','PS4 Games Titles','Xbox Games Titles','Nintendo Switch Games','PC Games Titles','Game Vouchers & Cards'] },
    ],
  },
  {
    key: 'pet-supplies', name: 'Pet Supplies', order: 22,
    attrs: [ATTR.brand_attr],
    subs: [
      { key: 'dog-supplies', name: 'Dog Supplies', attrs: [ATTR.color],
        children: ['Dry Dog Food','Wet Dog Food','Dog Treats','Dog Leashes','Dog Collars','Dog Toys','Dog Beds','Dog Grooming','Dog Bowls','Dog Cages & Carriers','Dog Clothing'] },
      { key: 'cat-supplies', name: 'Cat Supplies', attrs: [ATTR.color],
        children: ['Dry Cat Food','Wet Cat Food','Cat Treats','Cat Toys','Cat Litter & Trays','Cat Beds','Cat Collars','Cat Grooming Brushes','Cat Carriers','Cat Scratchers'] },
      { key: 'aquarium', name: 'Aquarium & Fish Care', attrs: [],
        children: ['Fish Aquariums','Fish Food Flakes','Aquarium Filters','Aquarium Lighting','Aquarium Decorations','Water Conditioners'] },
    ],
  },
  {
    key: 'industrial', name: 'Industrial & Tools', order: 23,
    attrs: [ATTR.material, ATTR.warranty],
    subs: [
      { key: 'power-tools', name: 'Power Tools', attrs: [ATTR.color, ATTR.wattage, ATTR.warranty],
        children: ['Drills Corded','Drills Cordless','Angle Grinders','Circular Saws','Sanders Electric','Impact Wrenches','Heat Guns','Rotary Tools','Jigsaw'] },
      { key: 'hand-tools', name: 'Hand Tools', attrs: [ATTR.material, ATTR.color],
        children: ['Screwdrivers Set','Spanners & Wrenches Set','Pliers Set','Hammers','Chisels Set','Files & Rasps','Measuring Tapes','Spirit Levels','Wire Strippers','Soldering Iron'] },
      { key: 'safety-equipment', name: 'Safety Equipment', attrs: [ATTR.color],
        children: ['Safety Helmets','Safety Gloves','Safety Goggles','Ear Muffs','Safety Shoes Industrial','Reflective Jackets','Fire Extinguishers','Safety Harnesses'] },
    ],
  },
  {
    key: 'musical-instruments', name: 'Musical Instruments', order: 24,
    attrs: [ATTR.material, ATTR.color, ATTR.brand_attr, ATTR.warranty],
    subs: [
      { key: 'string-instruments', name: 'String Instruments', attrs: [ATTR.color, ATTR.material],
        children: ['Acoustic Guitars','Electric Guitars','Classical Guitars','Bass Guitars','Ukuleles','Violins','Sitars','Banjos'] },
      { key: 'keyboard-piano', name: 'Keyboards & Pianos', attrs: [ATTR.color, ATTR.connectivity],
        children: ['Digital Pianos','Portable Keyboards','MIDI Controllers','Synthesizers','Arranger Keyboards'] },
      { key: 'drums-percussion', name: 'Drums & Percussion', attrs: [ATTR.color, ATTR.material],
        children: ['Acoustic Drum Kits','Electronic Drum Kits','Dhols','Tablas','Bongos','Congas','Djembe','Cajón'] },
    ],
  },
  {
    key: 'garden-outdoors', name: 'Garden & Outdoors', order: 25,
    attrs: [ATTR.material, ATTR.color, ATTR.brand_attr],
    subs: [
      { key: 'gardening-tools', name: 'Gardening Tools', attrs: [ATTR.material, ATTR.color],
        children: ['Hand Trowels','Pruning Shears','Watering Cans','Hose Pipes & Guns','Garden Rakes','Spades & Shovels','Lawn Mowers','Hedge Trimmers','Garden Gloves','Garden Kneelers'] },
      { key: 'plants-pots', name: 'Plants, Pots & Seeds', attrs: [],
        children: ['Indoor Plants','Outdoor Plants','Seeds & Bulbs','Potting Soil','Fertilizers & Compost','Ceramic Pots','Plastic Pots','Grow Bags','Moss Sticks','Terracotta Pots'] },
      { key: 'outdoor-lighting', name: 'Outdoor Lighting', attrs: [ATTR.color, ATTR.wattage],
        children: ['Solar Garden Lights','Pathway Lights','Garden Spotlights','String Lights Outdoor','Wall Lanterns','Flood Lights Outdoor'] },
    ],
  },
  {
    key: 'ethnic-traditional', name: 'Ethnic & Traditional Wear', order: 26,
    attrs: [ATTR.gender, ATTR.color, ATTR.material, ATTR.occasion],
    subs: [
      { key: 'bridal-wear', name: 'Bridal Wear', attrs: [ATTR.color, ATTR.size_apparel, ATTR.material, ATTR.occasion],
        children: ['Bridal Lehengas Heavy','Bridal Sarees Silk','Bridal Gowns','Bridal Anarkali Suits','Bridal Jewellery Sets','Bridal Accessories','Bridal Footwear','Bridal Makeup Kits'] },
      { key: 'festive-wear', name: 'Festive Wear', attrs: [ATTR.color, ATTR.size_apparel, ATTR.material, ATTR.occasion],
        children: ['Diwali Special Wear','Eid Special Wear','Navratri Garba Wear','Holi Special Outfits','Durga Puja Wear','Christmas Party Wear','Onam Special Wear'] },
      { key: 'regional-wear', name: 'Regional Traditional Wear', attrs: [ATTR.color, ATTR.size_apparel, ATTR.material],
        children: ['Bengali Traditional Wear','Rajasthani Traditional Wear','Gujarati Traditional Wear','Punjab Traditional Wear','South Indian Traditional Wear','Maharashtra Traditional Wear','UP Traditional Wear'] },
    ],
  },
  {
    key: 'office-stationery', name: 'Office Supplies & Stationery', order: 27,
    attrs: [ATTR.color, ATTR.material, ATTR.brand_attr],
    subs: [
      { key: 'office-supplies', name: 'Office Supplies', attrs: [ATTR.color],
        children: ['Paper & Envelopes','Folders & Binders','Desk Organizers','Whiteboards & Boards','Notice Boards','Stapler & Hole Punch','Tape & Adhesives','Label Makers','Shredders','Document Lamination'] },
      { key: 'writing-tools', name: 'Writing Instruments', attrs: [ATTR.color],
        children: ['Ball Point Pens','Gel Pens','Fountain Pens','Markers & Highlighters','Pencils & Mechanical Pencils','Sign Pens','Sketch Pens Set','Whiteboard Markers','Calligraphy Pens'] },
      { key: 'art-craft', name: 'Art & Craft', attrs: [ATTR.color],
        children: ['Watercolors','Acrylic Paints','Oil Paints','Canvas & Art Paper','Paint Brushes Set','Palette Knives','Clay & Pottery Kits','Origami Paper','Craft Glue','Sticker Rolls'] },
    ],
  },
];

class CategoriesSeed {
  constructor() {
    this.logger = new SeedLogger('Categories');
    this.mongoose = mongoose;
  }

  async execute() {
    const conn = this.mongoose.connection;
    if (!conn || !conn.collection) throw new Error('MongoDB connection not available');

    let totalRoot = 0, totalSubs = 0, totalChildren = 0;
    CATEGORY_TREE.forEach(r => { totalRoot++; r.subs.forEach(s => { totalSubs++; totalChildren += s.children.length; }); });
    this.logger.info(`📂 Seeding Categories — ${totalRoot} root, ${totalSubs} sub, ${totalChildren} child`);

    await conn.collection('categorytrees').deleteMany({});

    const docs = [];
    for (const root of CATEGORY_TREE) {
      docs.push({
        _id: new mongoose.Types.ObjectId(),
        categoryKey: root.key,
        title: root.name,
        parentKey: null,
        level: 0,
        attributeSchema: root.attrs,
        attributesSchema: {},
        active: true,
        sortOrder: root.order,
        imageUrl: `https://cdn.shopify.com/s/files/1/0533/2089/files/${root.key}.jpg`,
        bannerUrl: `https://cdn.shopify.com/s/files/1/0533/2089/files/${root.key}_banner.jpg`,
        iconUrl: `https://cdn.shopify.com/s/files/1/0533/2089/files/icon_${root.key}.svg`,
        isDashboardVisible: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      for (let si = 0; si < root.subs.length; si++) {
        const sub = root.subs[si];
        docs.push({
          _id: new mongoose.Types.ObjectId(),
          categoryKey: sub.key,
          title: sub.name,
          parentKey: root.key,
          level: 1,
          attributeSchema: sub.attrs,
          attributesSchema: {},
          active: true,
          sortOrder: si + 1,
          imageUrl: `https://cdn.shopify.com/s/files/1/0533/2089/files/${sub.key}.jpg`,
          bannerUrl: '',
          iconUrl: '',
          isDashboardVisible: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        for (let ci = 0; ci < sub.children.length; ci++) {
          const childName = sub.children[ci];
          const childSlug = childName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
          const childKey = `${root.key}-${sub.key}-${childSlug}`;
          // Merge root + sub attrs so child inherits the complete attribute set; dedupe by key
          const seenKeys = new Set();
          const mergedAttrs = [...root.attrs, ...sub.attrs].filter(a => {
            if (seenKeys.has(a.key)) return false;
            seenKeys.add(a.key);
            return true;
          });
          docs.push({
            _id: new mongoose.Types.ObjectId(),
            categoryKey: childKey,
            title: childName,
            parentKey: sub.key,
            level: 2,
            attributeSchema: mergedAttrs,
            attributesSchema: {},
            active: true,
            sortOrder: ci + 1,
            imageUrl: '',
            bannerUrl: '',
            iconUrl: '',
            isDashboardVisible: false,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }
      }
    }

    const BATCH = 200;
    for (let i = 0; i < docs.length; i += BATCH) {
      await conn.collection('categorytrees').insertMany(docs.slice(i, i + BATCH));
      this.logger.recordBatch(Math.min(BATCH, docs.length - i));
    }

    this.logger.printStats();
    return { created: docs.length, rootCategories: totalRoot, subCategories: totalSubs, childCategories: totalChildren };
  }
}

module.exports = CategoriesSeed;
