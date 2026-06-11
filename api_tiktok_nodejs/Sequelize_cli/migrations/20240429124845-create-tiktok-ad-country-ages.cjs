'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('tiktok_ad_country_ages', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      ad_id: {
        type: Sequelize.INTEGER,
        references: {
          model: 'tiktok_ads',
          key: 'id',
        }
      },
      country_name:{
        type: Sequelize.STRING,
        
      },
      age_details:{
      type: Sequelize.JSON,
      validate: {
        isObject(value) {
          if (typeof value !== 'object' || Array.isArray(value)) {
            throw new Error('age field must be an object');
          }
        },
      },
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
    await queryInterface.dropTable('tiktok_ad_country_ages');
  }
};