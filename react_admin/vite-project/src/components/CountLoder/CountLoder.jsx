import React from 'react';
import styles from './CountLoder.module.css';

const CountLoder = () => {
  return (
    <section className={styles.dotsContainer}>
      <div className={styles.dot}></div>
      <div className={styles.dot}></div>
      <div className={styles.dot}></div>
      <div className={styles.dot}></div>
      <div className={styles.dot}></div>
    </section>
  );
};

export default CountLoder;

