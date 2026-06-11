'use strict';

const { seedDatabase } = require('./src/services/sdui/seed/seeder');

seedDatabase()
  .then(() => {
    console.log('✅ Seed complete');
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Seed failed:', err.message);
    process.exit(1);
  });
