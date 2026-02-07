"use client";

import { useState } from "react";
import styles from "./page.module.css";
import { pullCloudToLocal, pushLocalToCloud } from "../lib/cloud/client";

export default function CloudSyncPanel() {
  const [status, setStatus] = useState("Idle");

  const handlePush = async () => {
    setStatus("Pushing to cloud...");
    try {
      await pushLocalToCloud();
      setStatus("Push complete.");
    } catch (error) {
      setStatus("Push failed.");
    }
  };

  const handlePull = async () => {
    setStatus("Pulling from cloud...");
    try {
      await pullCloudToLocal();
      setStatus("Pull complete.");
    } catch (error) {
      setStatus("Pull failed.");
    }
  };

  return (
    <div className={styles.cloudPanel}>
      <p className={styles.cloudStatus}>{status}</p>
      <div className={styles.cloudActions}>
        <button className={styles.primaryButton} onClick={handlePush}>
          Push to Cloud
        </button>
        <button className={styles.secondaryButton} onClick={handlePull}>
          Pull from Cloud
        </button>
      </div>
      <p className={styles.muted}>
        Cloud sync stores encrypted records in SQLite via the cloud API.
      </p>
    </div>
  );
}
