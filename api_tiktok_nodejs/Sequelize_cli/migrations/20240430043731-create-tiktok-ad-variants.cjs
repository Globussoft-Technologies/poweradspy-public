'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('tiktok_ad_variants', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true
      },
      ad_id: {
        type: Sequelize.INTEGER,
        references: {
          model: 'tiktok_ads',
          key: 'id',
        },
      },
      ad_title: {
        type: Sequelize.STRING
      },
      video_url_original: {
        type: Sequelize.TEXT
      },
      video_url: {
        type: Sequelize.TEXT
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('tiktok_ad_variants');
  }
};