'use strict';

const subcategoryMapping = {
  'Apparel & Accessories': [
    'Bags', 'Clothing Accessories', 'High-end Jewelry', "Men's Clothing", "Men's Shoes",
    'Ordinary Jewelry', 'Other Apparel & Accessories', 'Traditional & Ceremonial Clothing',
    'Watches', 'Wearable Tech Devices', "Women's Clothing", "Women's Shoes",
  ],
  'Appliances': [
    'Digital Devices', 'Home Appliances', 'Kitchen & Bathroom Appliances',
    'Large Appliances', 'Other Appliances', 'Personal Care Appliances',
  ],
  'Apps': [
    'Audio & Video Players', 'Business & Productivity', 'Education', 'Financial Services',
    'Health & Fitness', 'Life & Leisure', 'News & Reading', 'Online Shopping', 'Other Apps',
    'Parenting', 'Photography', 'Social', 'Travel', 'Utilities',
  ],
  'Baby, Kids & Maternity': [
    'Baby Bedding', 'Baby Feeding Supplies', 'Baby Food', 'Baby Formula',
    'Baby Hygiene Products', 'Baby Shoes', 'Child Car Seats', "Children's Apparel",
    'Diapers & Baby Wipes', 'Other Baby, Kids & Maternity', 'Strollers & Cribs', 'Toys for Kids',
  ],
  'Beauty & Personal Care': [
    'Aesthetic Medicine', 'Cosmetics', 'Feminine Care', 'Fragrances & Perfumes',
    'Haircare', 'Oral Care', 'Other Beauty & Personal Care', 'Skincare', 'Wig & Hair Styling',
  ],
  'Business Services': [
    'Agriculture, Forestry, Animal Husbandry & Fishing', 'Auction Services', 'Chemical Materials',
    'Constructional Engineering', 'Electronics & Electrical', 'Energy Conservation & Environmental Protection',
    'Exhibition Services', 'Franchising', 'Machinery & Equipment', 'Marketing & Advertising',
    'Office Equipment & Supplies', 'Other Business Services', 'Professional Consultation',
    'Real Estate & Home Rentals', 'Recruitment & Job Searching', 'Safety & Security', 'Service Outsourcing',
  ],
  'E-Commerce (Non-app)': [
    'Big Box Retailers', 'Large E-commerce Platforms', 'Small & Medium-sized E-commerce Platforms',
  ],
  'Education': [
    'Early Childhood & Preschool Education', 'Higher Education', 'Language Training',
    'Non-academic Training (Hobbies)', 'Other Education', 'Overseas Education',
    'Primary & Secondary Education & K-12', 'Vocational Training',
  ],
  'Financial Services': [
    'Commercial Banks', 'Credit Bureaus', 'Credit Cards', 'Crowd Funding', 'Cryptocurrencies',
    'Foreign Exchange Transactions', 'Funds', 'Guarantees', 'Investment Advisory', 'Loan Services',
    'Microfinance Companies', 'Other Financial Services', 'Pawn Shops', 'Precious Metals',
    'Securities', 'Third-Party Payments', 'Trusts',
  ],
  'Food & Beverage': [
    'Alcoholic Beverages', 'Cooking & Recipes', 'Cuisine', 'Food & Fresh Produce',
    'Non-alcoholic Beverages', 'Other Food & Beverage',
  ],
  'Games': [
    'Action', 'Casino', 'Hyper-Casual', 'Kids', 'Match', 'Other', 'Party', 'Puzzle',
    'Racing', 'RPG', 'Shooting', 'Simulation', 'Sports', 'Strategy', 'Tabletop',
  ],
  'Health': [
    'Dietary Supplements', 'Medical Information', 'Medical Services', 'Medicine', 'Other Health',
  ],
  'Home Improvement': [
    'Construction Materials & Lighting', 'Furniture', 'Hardware & Electrical', 'Home Decor',
    'Interior Design & Decorating Services', 'Other Home Improvement', 'Power Strips & Socket',
  ],
  'Household Products': [
    'Cleaning Appliances', 'Cleaning Supplies', 'Coffee Accessories', 'Daily Essentials',
    'Glasses & Drinkware', 'Kitchen Accessories', 'Laundry', 'Leather Care',
    'Other Household Products', 'Pest Control', 'Storage Products', 'Tea Sets',
    'Tissues & Wet Wipes', 'Toys',
  ],
  'Life Services': [
    'Beauty & Personal Care', 'Consumer Services', 'Dating & Matchmaking Services',
    'Exercise & Fitness', 'Gardening', 'Gifts & Flowers', 'Housekeeping', 'Internet Services',
    'Other Life Services', 'Photography', 'Shopping Services', 'Used Good Sales Platforms',
    'Utilities Payments', 'Wedding Celebrations', 'Wedding Photography',
  ],
  'News & Entertainment': [
    'Anime', 'Astrology', 'Beauty & Personal Care', 'Business & Economy', 'Car Information',
    'Celebrities & Gossip', 'Charity & Public Welfare', 'Collectables & Antiques', 'Culture & Art',
    'Culture & History', 'E-commerce Information', 'Environmental Protection', 'Food & Cooking',
    'Games & Utility Software', 'General Information', 'Humor', 'Law', 'Lifestyle News',
    'Live Events', 'Military', 'Movies', 'Other News & Entertainment', 'Pet Information',
    'Politics', 'Reading', 'Real Estate Information', 'Relationship Information',
    'Science & Technology', 'Social Media Account Promotion', 'Sports & Fitness',
    'Streaming Site', 'Tourist Information', 'TV Drama & Series', 'TV Variety Shows',
  ],
  'Pets': [
    'Other Pets', 'Pet Grooming', 'Pet Healthcare', 'Pet Household Products', 'Pet Toys',
    'Pet Travel Accessories', 'Pet Treats', 'Petfood',
  ],
  'Sports & Outdoor': [
    'Outdoor Equipment', 'Sports & Equipment',
  ],
  'Tech & Electronics': [
    'Cell Phones', 'Computer Accessories', 'Computer Repair', 'Computers',
    'Computers Components', 'Gaming Devices', 'Network Products', 'Office Equipment',
    'Other Tech & Electronics',
  ],
  'Travel': [
    'Hotels & Accommodation', 'Other Travel', 'Tours & Attractions', 'Travel Agencies & Services',
  ],
  'Vehicle & Transportation': [
    'Accessories for 2/3-Wheeled Vehicles', 'Airplanes', 'Auto Accessories', 'Auto Parts',
    'Auto Services', 'Automobiles', 'Bicycles', 'Car Dealerships', 'Car Rentals',
    'Electric Scooters', 'Motorcycles', 'Other Vehicle & Transportation', 'Used Cars', 'Water Vehicles',
  ],
};

/**
 * Title-case a string (e.g. "women's clothing" → "Women's Clothing").
 * Only capitalizes the first letter after a space or start of string,
 * so apostrophes like "'s" are not affected.
 */
function titleCase(str) {
  return str.replace(/(^|\s)\w/g, c => c.toUpperCase());
}

/**
 * Map a flat array of industry strings from ES into categories with subcategories.
 * Returns an array of { label, subcategories } matching the old API format.
 */
function mapIndustriesToCategories(industries) {
  const categoryLabels = Object.keys(subcategoryMapping);

  // Build fresh categories with empty subcategories
  const categories = categoryLabels.map(label => ({ label, subcategories: [] }));

  const titleCased = industries.map(i => titleCase(i));

  for (const industry of titleCased) {
    for (const [label, items] of Object.entries(subcategoryMapping)) {
      if (items.includes(industry)) {
        const category = categories.find(c => c.label === label);
        if (category && !category.subcategories.includes(industry)) {
          category.subcategories.push(industry);
        }
        break;
      }
    }
  }

  return categories;
}

module.exports = { mapIndustriesToCategories };
