"use strict";
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("tiktok_ad_html_lander", {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      ad_id: {
        type: Sequelize.INTEGER,
        references: {
          model: "tiktok_ads",
          key: "id",
        },
      },
      redirects: {
        type: Sequelize.JSON,
        defaultValue: [],
        validate: {
          isArray(value) {
            if (!Array.isArray(value)) {
              throw new Error("redirects field must be an array");
            }
          },
        },
      },
      outgoing_url: {
        type: Sequelize.JSON,
        defaultValue: [],
        validate: {
          isArray(value) {
            if (!Array.isArray(value)) {
              throw new Error("outgoing_url field must be an array");
            }
          },
        },
      },
      destinations: {
        type: Sequelize.STRING,
      },
      country_iso: {
        type: Sequelize.STRING,
      },
      html_path: {
        type: Sequelize.STRING,
      },
      html_content: {
        type: Sequelize.STRING,
      },
      screen_shot: {
        type: Sequelize.STRING,
      },
      status: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
      },
      domain_age: {
        type: Sequelize.INTEGER,
      },
      domain_registered_date: {
        type: Sequelize.STRING,
      },
      IsDataCenterProxy: {
        type: Sequelize.INTEGER,
      },
      crawled_by: {
        type: Sequelize.STRING,
      },
      ad_category: {
        type: Sequelize.JSON,
        defaultValue: [],
        validate: {
          isArray(value) {
            if (!Array.isArray(value)) {
              throw new Error("ad_category field must be an array");
            }
          },
        },
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
    });
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable("tiktok_ad_html_landers");
  },
};
