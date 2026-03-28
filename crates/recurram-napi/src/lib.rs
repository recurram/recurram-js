use recurram_bridge::{
    decode_direct, decode_to_compact_json, decode_to_transport_json, encode_batch_compact_json,
    encode_batch_direct_from_json, encode_batch_transport_json, encode_compact_json,
    encode_direct_from_json, encode_transport_json, encode_with_schema_transport_json, BridgeError,
    BridgeSessionEncoder, TransportValue,
};
use napi::bindgen_prelude::Buffer;
use napi_derive::napi;

fn to_napi_error(error: BridgeError) -> napi::Error {
    napi::Error::from_reason(error.to_string())
}

fn transport_to_json(transport: TransportValue) -> napi::Result<serde_json::Value> {
    serde_json::to_value(transport).map_err(|e| napi::Error::from_reason(e.to_string()))
}

// ── JSON-string based API (now using simd-json for parsing) ─────────────────

#[napi(js_name = "encodeTransportJson")]
pub fn encode_transport_json_napi(value_json: String) -> napi::Result<Buffer> {
    encode_transport_json(value_json)
        .map(Buffer::from)
        .map_err(to_napi_error)
}

#[napi(js_name = "decodeToTransportJson")]
pub fn decode_to_transport_json_napi(bytes: Buffer) -> napi::Result<String> {
    decode_to_transport_json(bytes.as_ref()).map_err(to_napi_error)
}

#[napi(js_name = "decodeToCompactJson")]
pub fn decode_to_compact_json_napi(bytes: Buffer) -> napi::Result<String> {
    decode_to_compact_json(bytes.as_ref()).map_err(to_napi_error)
}

#[napi(js_name = "encodeWithSchemaTransportJson")]
pub fn encode_with_schema_transport_json_napi(
    schema_json: String,
    value_json: String,
) -> napi::Result<Buffer> {
    encode_with_schema_transport_json(schema_json, value_json)
        .map(Buffer::from)
        .map_err(to_napi_error)
}

#[napi(js_name = "encodeBatchTransportJson")]
pub fn encode_batch_transport_json_napi(values_json: String) -> napi::Result<Buffer> {
    encode_batch_transport_json(values_json)
        .map(Buffer::from)
        .map_err(to_napi_error)
}

// ── Direct serde API (JS object → serde_json::Value → fast parse → encode) ─

#[napi(js_name = "encodeDirect")]
pub fn encode_direct_napi(value: serde_json::Value) -> napi::Result<Buffer> {
    encode_direct_from_json(value)
        .map(Buffer::from)
        .map_err(to_napi_error)
}

#[napi(js_name = "decodeDirect")]
pub fn decode_direct_napi(bytes: Buffer) -> napi::Result<serde_json::Value> {
    let transport = decode_direct(bytes.as_ref()).map_err(to_napi_error)?;
    transport_to_json(transport)
}

#[napi(js_name = "encodeBatchDirect")]
pub fn encode_batch_direct_napi(values: serde_json::Value) -> napi::Result<Buffer> {
    encode_batch_direct_from_json(values)
        .map(Buffer::from)
        .map_err(to_napi_error)
}

// ── Compact JSON API (smaller JSON via tagged arrays, simd-json parsed) ─────

#[napi(js_name = "encodeCompactJson")]
pub fn encode_compact_json_napi(json: String) -> napi::Result<Buffer> {
    encode_compact_json(json)
        .map(Buffer::from)
        .map_err(to_napi_error)
}

#[napi(js_name = "encodeBatchCompactJson")]
pub fn encode_batch_compact_json_napi(json: String) -> napi::Result<Buffer> {
    encode_batch_compact_json(json)
        .map(Buffer::from)
        .map_err(to_napi_error)
}

// ── Session encoder ─────────────────────────────────────────────────────────

#[napi]
pub struct SessionEncoder {
    inner: BridgeSessionEncoder,
}

#[napi]
impl SessionEncoder {
    #[napi(constructor)]
    pub fn new(options_json: Option<String>) -> napi::Result<Self> {
        let inner = BridgeSessionEncoder::new(options_json.as_deref()).map_err(to_napi_error)?;
        Ok(Self { inner })
    }

    // JSON-string methods (now using simd-json for parsing internally)
    #[napi(js_name = "encodeTransportJson")]
    pub fn encode_transport_json(&mut self, value_json: String) -> napi::Result<Buffer> {
        self.inner
            .encode_transport_json(value_json)
            .map(Buffer::from)
            .map_err(to_napi_error)
    }

    #[napi(js_name = "encodeWithSchemaTransportJson")]
    pub fn encode_with_schema_transport_json(
        &mut self,
        schema_json: String,
        value_json: String,
    ) -> napi::Result<Buffer> {
        self.inner
            .encode_with_schema_transport_json(schema_json, value_json)
            .map(Buffer::from)
            .map_err(to_napi_error)
    }

    #[napi(js_name = "encodeBatchTransportJson")]
    pub fn encode_batch_transport_json(&mut self, values_json: String) -> napi::Result<Buffer> {
        self.inner
            .encode_batch_transport_json(values_json)
            .map(Buffer::from)
            .map_err(to_napi_error)
    }

    #[napi(js_name = "encodePatchTransportJson")]
    pub fn encode_patch_transport_json(&mut self, value_json: String) -> napi::Result<Buffer> {
        self.inner
            .encode_patch_transport_json(value_json)
            .map(Buffer::from)
            .map_err(to_napi_error)
    }

    #[napi(js_name = "encodeMicroBatchTransportJson")]
    pub fn encode_micro_batch_transport_json(
        &mut self,
        values_json: String,
    ) -> napi::Result<Buffer> {
        self.inner
            .encode_micro_batch_transport_json(values_json)
            .map(Buffer::from)
            .map_err(to_napi_error)
    }

    // Direct serde methods (JS object → serde_json::Value → fast parse → encode)
    #[napi(js_name = "encodeDirect")]
    pub fn encode_direct(&mut self, value: serde_json::Value) -> napi::Result<Buffer> {
        self.inner
            .encode_direct_from_json(value)
            .map(Buffer::from)
            .map_err(to_napi_error)
    }

    #[napi(js_name = "encodeBatchDirect")]
    pub fn encode_batch_direct(&mut self, values: serde_json::Value) -> napi::Result<Buffer> {
        self.inner
            .encode_batch_direct_from_json(values)
            .map(Buffer::from)
            .map_err(to_napi_error)
    }

    #[napi(js_name = "encodePatchDirect")]
    pub fn encode_patch_direct(&mut self, value: serde_json::Value) -> napi::Result<Buffer> {
        self.inner
            .encode_patch_direct_from_json(value)
            .map(Buffer::from)
            .map_err(to_napi_error)
    }

    #[napi(js_name = "encodeMicroBatchDirect")]
    pub fn encode_micro_batch_direct(&mut self, values: serde_json::Value) -> napi::Result<Buffer> {
        self.inner
            .encode_micro_batch_direct_from_json(values)
            .map(Buffer::from)
            .map_err(to_napi_error)
    }

    // Compact JSON methods (tagged array format, ~50% smaller JSON, simd-json parsed)
    #[napi(js_name = "encodeCompactJson")]
    pub fn encode_compact_json(&mut self, json: String) -> napi::Result<Buffer> {
        self.inner
            .encode_compact_json(json)
            .map(Buffer::from)
            .map_err(to_napi_error)
    }

    #[napi(js_name = "encodeBatchCompactJson")]
    pub fn encode_batch_compact_json(&mut self, json: String) -> napi::Result<Buffer> {
        self.inner
            .encode_batch_compact_json(json)
            .map(Buffer::from)
            .map_err(to_napi_error)
    }

    #[napi(js_name = "encodePatchCompactJson")]
    pub fn encode_patch_compact_json(&mut self, json: String) -> napi::Result<Buffer> {
        self.inner
            .encode_patch_compact_json(json)
            .map(Buffer::from)
            .map_err(to_napi_error)
    }

    #[napi(js_name = "encodeMicroBatchCompactJson")]
    pub fn encode_micro_batch_compact_json(&mut self, json: String) -> napi::Result<Buffer> {
        self.inner
            .encode_micro_batch_compact_json(json)
            .map(Buffer::from)
            .map_err(to_napi_error)
    }

    #[napi]
    pub fn reset(&mut self) {
        self.inner.reset();
    }
}

#[napi(js_name = "createSessionEncoder")]
pub fn create_session_encoder(options_json: Option<String>) -> napi::Result<SessionEncoder> {
    SessionEncoder::new(options_json)
}
