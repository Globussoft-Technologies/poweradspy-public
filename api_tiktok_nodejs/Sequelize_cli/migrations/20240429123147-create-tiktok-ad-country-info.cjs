'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('tiktok_ad_country_info', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true
      },
      iso: {
        type: Sequelize.CHAR(2),
        allowNull: false,
      },
      name: {
        type: Sequelize.STRING(80),
        allowNull: false,
      },
      nicename: {
        type: Sequelize.STRING(80),
        allowNull: false,
      },
      iso3: {
        type: Sequelize.CHAR(3),
        allowNull: false,
      },
      numcode: {
        type: Sequelize.SMALLINT,
        allowNull: false,
      },
      phonecode: {
        type: Sequelize.INTEGER,
        allowNull: false,
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
    await queryInterface.dropTable('tiktok_ad_country_info');
  }
};