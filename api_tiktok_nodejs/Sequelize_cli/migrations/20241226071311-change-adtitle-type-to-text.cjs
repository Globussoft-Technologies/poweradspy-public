'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.changeColumn('tiktok_ad_variants', 'ad_title', {
      type: Sequelize.TEXT,
    });
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.changeColumn('tiktok_ad_variants', 'ad_title', {
      type: Sequelize.STRING,
    });
  }
};
