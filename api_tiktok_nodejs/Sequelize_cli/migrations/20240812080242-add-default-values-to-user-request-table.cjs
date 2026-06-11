'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('user_requests', 'user_id', {
      type: Sequelize.INTEGER,
      allowNull: false,
    });

    await queryInterface.changeColumn('user_requests', 'sent_status', {
      type: Sequelize.INTEGER,
      defaultValue: 0,
      comment: '1-Processing, 2-New Ad Got, 3-Mail Sent Successfully',
    });

    await queryInterface.changeColumn('user_requests', 'user_type', {
      type: Sequelize.INTEGER,
      comment: '0-Free, 1-Paid',
    });

    await queryInterface.changeColumn('user_requests', 'keyword_status', {
      type: Sequelize.INTEGER,
      defaultValue: 0,
      comment: '0-not processed, 1-ad found, 2-No ads found',
    });

    await queryInterface.changeColumn('user_requests', 'advertiser_status', {
      type: Sequelize.INTEGER,
      defaultValue: 0,
      comment: '0-not processed, 1-ad found, 2-No ads found',
    });

    await queryInterface.changeColumn('user_requests', 'url_status', {
      type: Sequelize.INTEGER,
      defaultValue: 0,
      comment: '0-not processed, 1-ad found, 2-No ads found',
    });

    await queryInterface.changeColumn('user_requests', 'priority_flag', {
      type: Sequelize.INTEGER,
      defaultValue: 0,
      comment: '0-normal, 1-top on priority',
    });

    await queryInterface.changeColumn('user_requests', 'processed_date', {
      type: Sequelize.DATE,
      defaultValue: Sequelize.fn('NOW'),
    });
  },
};
