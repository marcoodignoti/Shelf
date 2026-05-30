//! Performance budget tests. Ignored by default (`cargo test` in the gate
//! skips them); run with `cargo test -- --ignored` via `npm run perf:backend`.
//! Budgets are set from the first measured value on the reference machine
//! (see perf/README.md). Adjust the constants below after baselining.

use crate::{configure_sqlite_database, create_page_record, run_migrations, update_page_content};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::path::{Path, PathBuf};
use std::time::Instant;

const INSERT_COUNT: usize = 5_000;
const INSERT_BUDGET_MS: u128 = 2_200; // baseline 1655 ms × 1.3 ≈ 2152; rounded up
const DISK_BUDGET_BYTES: u64 = 1_200_000; // baseline 892928 bytes × 1.3 ≈ 1160806; rounded up

/// Unique temp file path for one perf run. Plain std, no `tempfile` dep.
fn temp_db_path(tag: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    std::env::temp_dir().join(format!("opennotion-perf-{tag}-{nanos}.db"))
}

/// File-backed pool configured exactly like production (WAL + NORMAL).
async fn file_backed_pool(path: &Path) -> SqlitePool {
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true);
    let db = SqlitePoolOptions::new()
        .connect_with(options)
        .await
        .expect("connect file-backed sqlite");
    run_migrations(&db).await.expect("run migrations");
    configure_sqlite_database(&db)
        .await
        .expect("configure sqlite");
    db
}

/// Checkpoint WAL into the main file, then return main-file size in bytes.
async fn checkpointed_db_size(db: &SqlitePool, path: &Path) -> u64 {
    sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
        .execute(db)
        .await
        .expect("wal checkpoint");
    std::fs::metadata(path).expect("stat db file").len()
}

fn cleanup(path: &Path) {
    let _ = std::fs::remove_file(path);
    let _ = std::fs::remove_file(path.with_extension("db-wal"));
    let _ = std::fs::remove_file(path.with_extension("db-shm"));
}

#[ignore = "perf budget test; run via npm run perf:backend"]
#[test]
fn cold_insert_throughput_and_disk_size() {
    // Matches the existing `mod tests` pattern in lib.rs: plain `#[test]`
    // driving an async body via tauri's runtime. There is NO `tokio` dev-dep,
    // so `#[tokio::test]` would not compile — do not use it.
    tauri::async_runtime::block_on(async {
        let path = temp_db_path("cold-insert");
        let db = file_backed_pool(&path).await;

        let start = Instant::now();
        for i in 0..INSERT_COUNT {
            let id = format!("perf-{i}");
            let title = format!("Perf page {i}");
            create_page_record(&db, &id, &title, None, "2026-01-01T00:00:00Z")
                .await
                .expect("insert page");
        }
        let elapsed_ms = start.elapsed().as_millis();

        let size_bytes = checkpointed_db_size(&db, &path).await;
        db.close().await;
        cleanup(&path);

        println!(
            "PERF cold-insert: {INSERT_COUNT} pages in {elapsed_ms} ms, db {size_bytes} bytes"
        );
        assert!(
            elapsed_ms <= INSERT_BUDGET_MS,
            "insert took {elapsed_ms} ms, budget {INSERT_BUDGET_MS} ms"
        );
        assert!(
            size_bytes <= DISK_BUDGET_BYTES,
            "db size {size_bytes} bytes, budget {DISK_BUDGET_BYTES} bytes"
        );
    });
}

const CHURN_PAGES: usize = 50;
const CHURN_CYCLES: usize = 2_000;
const CHURN_DISK_BUDGET_BYTES: u64 = 640_000; // baseline 471040 bytes × 1.3 ≈ 612352; rounded up

/// Simulates a long editing session: a small working set of pages whose
/// content is rewritten thousands of times. Without VACUUM, repeated
/// UPDATEs of large TEXT bloat the file via free pages; this asserts that
/// after a VACUUM the file stays bounded (long-session disk stability).
#[ignore = "perf budget test; run via npm run perf:backend"]
#[test]
fn long_session_churn_disk_stays_bounded() {
    tauri::async_runtime::block_on(async {
        let path = temp_db_path("churn");
        let db = file_backed_pool(&path).await;

        // A realistic-ish block-content payload (~4 KB) rewritten repeatedly.
        let body = "x".repeat(4_000);

        for i in 0..CHURN_PAGES {
            let id = format!("churn-{i}");
            create_page_record(&db, &id, "Churn page", None, "2026-01-01T00:00:00Z")
                .await
                .expect("seed page");
        }

        for cycle in 0..CHURN_CYCLES {
            let id = format!("churn-{}", cycle % CHURN_PAGES);
            let content = format!("{{\"v\":{cycle},\"body\":\"{body}\"}}");
            update_page_content(&db, &id, &content, &body, "2026-01-01T00:00:01Z")
                .await
                .expect("update content");
        }

        sqlx::query("VACUUM").execute(&db).await.expect("vacuum");
        let size_bytes = checkpointed_db_size(&db, &path).await;
        db.close().await;
        cleanup(&path);

        println!("PERF churn: {CHURN_CYCLES} updates, post-vacuum db {size_bytes} bytes");
        assert!(
            size_bytes <= CHURN_DISK_BUDGET_BYTES,
            "post-churn db {size_bytes} bytes, budget {CHURN_DISK_BUDGET_BYTES} bytes"
        );
    });
}
