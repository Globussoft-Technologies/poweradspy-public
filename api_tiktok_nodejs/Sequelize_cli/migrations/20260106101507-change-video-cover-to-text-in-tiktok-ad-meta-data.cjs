'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn("tiktok_ad_meta_data", "video_cover", {
      type: Sequelize.TEXT,
      allowNull: true, // keep same nullability as before
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn("tiktok_ad_meta_data", "video_cover", {
      type: Sequelize.STRING,
      allowNull: true, // keep same nullability as before
    });
  },
};
