import styles from "./page.module.css";
import CareBaseDemo from "./CareBaseDemo";
import AgentChat from "../components/AgentChat/AgentChat";
import CloudSyncPanel from "./CloudSyncPanel";
import MasterKeyPanel from "../components/KeyManager/MasterKeyPanel";
import SupportToolsPanel from "../components/KeyManager/SupportToolsPanel";

export default function Home() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <div className={styles.hero}>
          <p className={styles.kicker}>CareBase</p>
          <h1>Dataflow guardrails for persistent memory.</h1>
          <p className={styles.subtitle}>
            This sandbox shows the Dataflow Guard modal in action while executing
            CareBase commands against local encrypted storage.
          </p>
        </div>
        <section className={styles.status}>
          <h2>Dataflow Guard Demo</h2>
          <CareBaseDemo />
        </section>
        <section className={styles.status}>
          <h2>Test Agent</h2>
          <AgentChat />
        </section>
        <section className={styles.status}>
          <h2>CareBase Cloud</h2>
          <CloudSyncPanel />
        </section>
        <section className={styles.status}>
          <h2>Master Key</h2>
          <MasterKeyPanel />
        </section>
        <section className={styles.status}>
          <h2>Support Tools</h2>
          <SupportToolsPanel />
        </section>
      </main>
    </div>
  );
}
