use gowe_bridge::{
    decode_to_transport_json, encode_batch_transport_json, encode_transport_json,
    encode_with_schema_transport_json, BridgeSessionEncoder,
};
use wasm_bindgen::prelude::*;

fn into_js_error(error: impl ToString) -> JsValue {
    JsValue::from_str(&error.to_string())
}

#[wasm_bindgen(js_name = encodeTransportJson)]
pub fn encode_transport_json_wasm(value_json: String) -> Result<Vec<u8>, JsValue> {
    encode_transport_json(value_json).map_err(into_js_error)
}

#[wasm_bindgen(js_name = decodeToTransportJson)]
pub fn decode_to_transport_json_wasm(bytes: &[u8]) -> Result<String, JsValue> {
    decode_to_transport_json(bytes).map_err(into_js_error)
}

#[wasm_bindgen(js_name = encodeWithSchemaTransportJson)]
pub fn encode_with_schema_transport_json_wasm(
    schema_json: String,
    value_json: String,
) -> Result<Vec<u8>, JsValue> {
    encode_with_schema_transport_json(schema_json, value_json).map_err(into_js_error)
}

#[wasm_bindgen(js_name = encodeBatchTransportJson)]
pub fn encode_batch_transport_json_wasm(values_json: String) -> Result<Vec<u8>, JsValue> {
    encode_batch_transport_json(values_json).map_err(into_js_error)
}

#[wasm_bindgen]
pub struct SessionEncoder {
    inner: BridgeSessionEncoder,
}

#[wasm_bindgen]
impl SessionEncoder {
    #[wasm_bindgen(constructor)]
    pub fn new(options_json: Option<String>) -> Result<SessionEncoder, JsValue> {
        let inner = BridgeSessionEncoder::new(options_json.as_deref()).map_err(into_js_error)?;
        Ok(Self { inner })
    }

    #[wasm_bindgen(js_name = encodeTransportJson)]
    pub fn encode_transport_json(&mut self, value_json: String) -> Result<Vec<u8>, JsValue> {
        self.inner
            .encode_transport_json(value_json)
            .map_err(into_js_error)
    }

    #[wasm_bindgen(js_name = encodeWithSchemaTransportJson)]
    pub fn encode_with_schema_transport_json(
        &mut self,
        schema_json: String,
        value_json: String,
    ) -> Result<Vec<u8>, JsValue> {
        self.inner
            .encode_with_schema_transport_json(schema_json, value_json)
            .map_err(into_js_error)
    }

    #[wasm_bindgen(js_name = encodeBatchTransportJson)]
    pub fn encode_batch_transport_json(&mut self, values_json: String) -> Result<Vec<u8>, JsValue> {
        self.inner
            .encode_batch_transport_json(values_json)
            .map_err(into_js_error)
    }

    #[wasm_bindgen(js_name = encodePatchTransportJson)]
    pub fn encode_patch_transport_json(&mut self, value_json: String) -> Result<Vec<u8>, JsValue> {
        self.inner
            .encode_patch_transport_json(value_json)
            .map_err(into_js_error)
    }

    #[wasm_bindgen(js_name = encodeMicroBatchTransportJson)]
    pub fn encode_micro_batch_transport_json(
        &mut self,
        values_json: String,
    ) -> Result<Vec<u8>, JsValue> {
        self.inner
            .encode_micro_batch_transport_json(values_json)
            .map_err(into_js_error)
    }

    #[wasm_bindgen]
    pub fn reset(&mut self) {
        self.inner.reset();
    }
}

#[wasm_bindgen(js_name = createSessionEncoder)]
pub fn create_session_encoder(options_json: Option<String>) -> Result<SessionEncoder, JsValue> {
    SessionEncoder::new(options_json)
}
