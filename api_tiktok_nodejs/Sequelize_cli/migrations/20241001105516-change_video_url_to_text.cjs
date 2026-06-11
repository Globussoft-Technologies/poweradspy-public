'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.changeColumn('tiktok_ad_meta_data', 'video_url', {
      type: Sequelize.TEXT,
      allowNull: false, 
    });
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.changeColumn('tiktok_ad_meta_data', 'video_url', {
      type: Sequelize.STRING,
     
    });
  }
};
