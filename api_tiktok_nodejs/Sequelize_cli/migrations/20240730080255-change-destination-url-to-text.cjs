'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.changeColumn('tiktok_ad_meta_data', 'destination_url', {
      type: Sequelize.TEXT,
      allowNull: false, 
    });
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.changeColumn('tiktok_ad_meta_data', 'destination_url', {
      type: Sequelize.STRING,
     
    });
  }
};
