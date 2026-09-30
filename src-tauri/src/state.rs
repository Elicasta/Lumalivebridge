use crate::db::Database;
use crate::models::RuntimeInfo;
use crate::pairing::PairingGate;
use std::sync::{Arc, RwLock};

#[derive(Clone)]
pub struct AppState {
    pub db: Arc<Database>,
    pub runtime: Arc<RwLock<RuntimeInfo>>,
    pub remote_token: Arc<String>,
    pub pairing: Arc<PairingGate>,
}
