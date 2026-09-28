use crate::bridge::AbletonBridge;
use crate::db::Database;
use crate::models::RuntimeInfo;
use std::sync::{Arc, RwLock};

#[derive(Clone)]
pub struct AppState {
    pub db: Arc<Database>,
    pub runtime: Arc<RwLock<RuntimeInfo>>,
    pub remote_token: Arc<String>,
    pub bridge: AbletonBridge,
}
