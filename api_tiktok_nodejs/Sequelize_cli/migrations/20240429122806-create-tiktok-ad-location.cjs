'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('tiktok_ad_location', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true
      },
      ad_id: {
        type: Sequelize.INTEGER,
        unique:true,
        references: {
          model: 'tiktok_ads',
          key: 'id',
        }
      },
      countries: {
        type: Sequelize.JSON,
        defaultValue: [],
        validate: {
          isArray(value) {
            if (!Array.isArray(value)) {
              throw new Error('countries field must be an array');
            }
          },
        },
      },
      state: {
        type: Sequelize.STRING,
      },
      city: {
        type: Sequelize.STRING,
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
    await queryInterface.dropTable('tiktok_ad_location');
  }
};