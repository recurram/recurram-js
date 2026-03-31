use std::{cell::RefCell, collections::HashMap, ffi::CString};

use napi::bindgen_prelude::Buffer;
use napi::{
    sys, Env, JsBuffer, JsObject, JsTypedArray, JsUnknown, KeyCollectionMode, KeyConversion,
    KeyFilter, NapiRaw, NapiValue, TypedArrayType, ValueType,
};
use napi_derive::napi;
use recurram_bridge::{
    decode_direct, decode_to_compact_json, decode_to_transport_json, encode_batch_compact_json,
    encode_batch_direct_from_json, encode_batch_transport_json, encode_compact_json,
    encode_direct_from_json, encode_transport_json, encode_with_schema_transport_json, BridgeError,
    BridgeSessionEncoder, TransportValue,
};
use recurram_core::{
    decode as decode_value,
    wire::{decode_zigzag, encode_string, encode_varuint, encode_zigzag, Reader},
    Value,
};

const MESSAGE_SCALAR: u8 = 0x00;
const MESSAGE_ARRAY: u8 = 0x01;
const MESSAGE_MAP: u8 = 0x02;

const KEY_LITERAL: u8 = 0;

const TAG_NULL: u8 = 0;
const TAG_BOOL_FALSE: u8 = 1;
const TAG_BOOL_TRUE: u8 = 2;
const TAG_I64: u8 = 3;
const TAG_U64: u8 = 4;
const TAG_F64: u8 = 5;
const TAG_STRING: u8 = 6;
const TAG_BINARY: u8 = 7;
const TAG_ARRAY: u8 = 8;
const TAG_MAP: u8 = 9;

const STRING_EMPTY: u8 = 0;
const STRING_LITERAL: u8 = 1;
const MAX_SAFE_INTEGER_F64: f64 = 9_007_199_254_740_991.0;
const MAX_I64_AS_U64: u64 = i64::MAX as u64;

thread_local! {
    static ENCODED_MAP_KEY_CACHE: RefCell<HashMap<String, Box<[u8]>>> = RefCell::new(HashMap::new());
    static ENCODED_STRING_VALUE_CACHE: RefCell<HashMap<String, Box<[u8]>>> = RefCell::new(HashMap::new());
    static PROPERTY_NAME_CACHE: RefCell<HashMap<String, CString>> = RefCell::new(HashMap::new());
}

fn to_napi_error(error: BridgeError) -> napi::Error {
    napi::Error::from_reason(error.to_string())
}

fn invalid_arg(message: &str) -> napi::Error {
    napi::Error::new(napi::Status::InvalidArg, message.to_owned())
}

fn transport_to_json(transport: TransportValue) -> napi::Result<serde_json::Value> {
    serde_json::to_value(transport).map_err(|e| napi::Error::from_reason(e.to_string()))
}

fn own_enumerable_property_names(object: &JsObject) -> napi::Result<JsObject> {
    object.get_all_property_names(
        KeyCollectionMode::OwnOnly,
        KeyFilter::Enumerable,
        KeyConversion::NumbersToStrings,
    )
}

fn append_cached_map_key(name: &str, out: &mut Vec<u8>) {
    ENCODED_MAP_KEY_CACHE.with(|cache| {
        let mut cache = cache.borrow_mut();
        if let Some(encoded) = cache.get(name) {
            out.extend_from_slice(encoded);
            return;
        }

        let mut encoded = Vec::with_capacity(name.len() + 8);
        encode_string(name, &mut encoded);
        out.extend_from_slice(&encoded);

        if cache.len() >= 4096 {
            cache.clear();
        }
        cache.insert(name.to_owned(), encoded.into_boxed_slice());
    });
}

fn append_cached_string_value(value: &str, out: &mut Vec<u8>) {
    if value.len() > 64 {
        encode_string(value, out);
        return;
    }

    ENCODED_STRING_VALUE_CACHE.with(|cache| {
        let mut cache = cache.borrow_mut();
        if let Some(encoded) = cache.get(value) {
            out.extend_from_slice(encoded);
            return;
        }

        let mut encoded = Vec::with_capacity(value.len() + 8);
        encode_string(value, &mut encoded);
        out.extend_from_slice(&encoded);

        if cache.len() >= 4096 {
            cache.clear();
        }
        cache.insert(value.to_owned(), encoded.into_boxed_slice());
    });
}

fn with_cached_property_name<T>(
    name: &str,
    f: impl FnOnce(&CString) -> napi::Result<T>,
) -> napi::Result<T> {
    PROPERTY_NAME_CACHE.with(|cache| {
        let mut cache = cache.borrow_mut();
        if !cache.contains_key(name) {
            let cstring = CString::new(name)
                .map_err(|_| invalid_arg("object keys containing NUL are not supported"))?;
            if cache.len() >= 4096 {
                cache.clear();
            }
            cache.insert(name.to_owned(), cstring);
        }
        let cstring = cache
            .get(name)
            .ok_or_else(|| invalid_arg("failed to cache property name"))?;
        f(cstring)
    })
}

fn set_named_property_cached(
    env: &Env,
    object: &mut JsObject,
    name: &str,
    value: JsUnknown,
) -> napi::Result<()> {
    with_cached_property_name(name, |cstring| {
        napi::check_status!(
            unsafe {
                sys::napi_set_named_property(env.raw(), object.raw(), cstring.as_ptr(), value.raw())
            },
            "set_named_property_cached error"
        )
    })
}

/// Faster property setter that avoids HashMap lookup for short ASCII-safe names
/// by using a stack-allocated null-terminated buffer.
#[inline(always)]
fn set_named_property_fast(
    env: &Env,
    object: &JsObject,
    name: &str,
    value: sys::napi_value,
) -> napi::Result<()> {
    let bytes = name.as_bytes();
    if bytes.len() < 64 && !bytes.contains(&0) {
        let mut buf = [0u8; 64];
        buf[..bytes.len()].copy_from_slice(bytes);
        napi::check_status!(
            unsafe {
                sys::napi_set_named_property(env.raw(), object.raw(), buf.as_ptr().cast(), value)
            },
            "set_named_property_fast error"
        )
    } else {
        with_cached_property_name(name, |cstring| {
            napi::check_status!(
                unsafe {
                    sys::napi_set_named_property(env.raw(), object.raw(), cstring.as_ptr(), value)
                },
                "set_named_property_fast (fallback) error"
            )
        })
    }
}

/// Fast map key write for short keys (< 128 bytes): avoids HashMap by encoding inline.
#[inline(always)]
fn write_map_key_fast(name: &str, out: &mut Vec<u8>) {
    let bytes = name.as_bytes();
    if bytes.len() < 0x80 {
        // 1-byte varint length + key bytes — no cache lookup needed
        out.push(bytes.len() as u8);
        out.extend_from_slice(bytes);
    } else {
        // Fallback: use cached encoding for long keys
        append_cached_map_key(name, out);
    }
}

fn get_array_length_raw(env: &Env, value: sys::napi_value) -> napi::Result<u32> {
    let mut length = 0u32;
    napi::check_status!(
        unsafe { sys::napi_get_array_length(env.raw(), value, &mut length) },
        "get_array_length_raw error"
    )?;
    Ok(length)
}

fn is_array_raw(env: &Env, value: sys::napi_value) -> napi::Result<bool> {
    let mut out = false;
    napi::check_status!(
        unsafe { sys::napi_is_array(env.raw(), value, &mut out) },
        "is_array_raw error"
    )?;
    Ok(out)
}

fn is_buffer_raw(env: &Env, value: sys::napi_value) -> napi::Result<bool> {
    let mut out = false;
    napi::check_status!(
        unsafe { sys::napi_is_buffer(env.raw(), value, &mut out) },
        "is_buffer_raw error"
    )?;
    Ok(out)
}

fn is_typedarray_raw(env: &Env, value: sys::napi_value) -> napi::Result<bool> {
    let mut out = false;
    napi::check_status!(
        unsafe { sys::napi_is_typedarray(env.raw(), value, &mut out) },
        "is_typedarray_raw error"
    )?;
    Ok(out)
}

fn is_dataview_raw(env: &Env, value: sys::napi_value) -> napi::Result<bool> {
    let mut out = false;
    napi::check_status!(
        unsafe { sys::napi_is_dataview(env.raw(), value, &mut out) },
        "is_dataview_raw error"
    )?;
    Ok(out)
}

fn is_date_raw(env: &Env, value: sys::napi_value) -> napi::Result<bool> {
    let mut out = false;
    napi::check_status!(
        unsafe { sys::napi_is_date(env.raw(), value, &mut out) },
        "is_date_raw error"
    )?;
    Ok(out)
}

fn get_element_raw(env: &Env, value: sys::napi_value, index: u32) -> napi::Result<JsUnknown> {
    let mut raw_value = std::ptr::null_mut();
    napi::check_status!(
        unsafe { sys::napi_get_element(env.raw(), value, index, &mut raw_value) },
        "get_element_raw error"
    )?;
    Ok(unsafe { JsUnknown::from_raw_unchecked(env.raw(), raw_value) })
}

fn set_element_raw(
    env: &Env,
    object: &JsObject,
    index: u32,
    value: sys::napi_value,
) -> napi::Result<()> {
    napi::check_status!(
        unsafe { sys::napi_set_element(env.raw(), object.raw(), index, value) },
        "set_element_raw error"
    )
}

fn create_array_with_length_raw(env: &Env, length: usize) -> napi::Result<JsObject> {
    let mut raw_value = std::ptr::null_mut();
    napi::check_status!(
        unsafe { sys::napi_create_array_with_length(env.raw(), length, &mut raw_value) },
        "create_array_with_length_raw error"
    )?;
    Ok(unsafe { JsObject::from_raw_unchecked(env.raw(), raw_value) })
}

fn create_object_raw(env: &Env) -> napi::Result<JsObject> {
    let mut raw_value = std::ptr::null_mut();
    napi::check_status!(
        unsafe { sys::napi_create_object(env.raw(), &mut raw_value) },
        "create_object_raw error"
    )?;
    Ok(unsafe { JsObject::from_raw_unchecked(env.raw(), raw_value) })
}

fn create_null_raw(env: &Env) -> napi::Result<sys::napi_value> {
    let mut raw_value = std::ptr::null_mut();
    napi::check_status!(
        unsafe { sys::napi_get_null(env.raw(), &mut raw_value) },
        "create_null_raw error"
    )?;
    Ok(raw_value)
}

fn create_boolean_raw(env: &Env, value: bool) -> napi::Result<sys::napi_value> {
    let mut raw_value = std::ptr::null_mut();
    napi::check_status!(
        unsafe { sys::napi_get_boolean(env.raw(), value, &mut raw_value) },
        "create_boolean_raw error"
    )?;
    Ok(raw_value)
}

fn create_double_value_raw(env: &Env, value: f64) -> napi::Result<sys::napi_value> {
    let mut raw_value = std::ptr::null_mut();
    napi::check_status!(
        unsafe { sys::napi_create_double(env.raw(), value, &mut raw_value) },
        "create_double_value_raw error"
    )?;
    Ok(raw_value)
}

fn create_bigint_i64_value_raw(env: &Env, value: i64) -> napi::Result<sys::napi_value> {
    let mut raw_value = std::ptr::null_mut();
    napi::check_status!(
        unsafe { sys::napi_create_bigint_int64(env.raw(), value, &mut raw_value) },
        "create_bigint_i64_value_raw error"
    )?;
    Ok(raw_value)
}

fn create_bigint_u64_value_raw(env: &Env, value: u64) -> napi::Result<sys::napi_value> {
    let mut raw_value = std::ptr::null_mut();
    napi::check_status!(
        unsafe { sys::napi_create_bigint_uint64(env.raw(), value, &mut raw_value) },
        "create_bigint_u64_value_raw error"
    )?;
    Ok(raw_value)
}

fn create_string_raw(env: &Env, value: &str) -> napi::Result<sys::napi_value> {
    create_string_bytes_raw(env, value.as_bytes())
}

fn create_string_bytes_raw(env: &Env, value: &[u8]) -> napi::Result<sys::napi_value> {
    let mut raw_value = std::ptr::null_mut();
    napi::check_status!(
        unsafe {
            sys::napi_create_string_utf8(
                env.raw(),
                value.as_ptr().cast(),
                value.len(),
                &mut raw_value,
            )
        },
        "create_string_bytes_raw error"
    )?;
    Ok(raw_value)
}

fn create_buffer_copy_raw(env: &Env, value: &[u8]) -> napi::Result<sys::napi_value> {
    let mut raw_value = std::ptr::null_mut();
    let mut copied_data = std::ptr::null_mut();
    napi::check_status!(
        unsafe {
            sys::napi_create_buffer_copy(
                env.raw(),
                value.len(),
                value.as_ptr().cast(),
                &mut copied_data,
                &mut raw_value,
            )
        },
        "create_buffer_copy_raw error"
    )?;
    let _ = copied_data;
    Ok(raw_value)
}

fn get_bool_raw(env: &Env, value: sys::napi_value) -> napi::Result<bool> {
    let mut out = false;
    napi::check_status!(
        unsafe { sys::napi_get_value_bool(env.raw(), value, &mut out) },
        "get_bool_raw error"
    )?;
    Ok(out)
}

fn get_double_raw(env: &Env, value: sys::napi_value) -> napi::Result<f64> {
    let mut out = 0.0f64;
    napi::check_status!(
        unsafe { sys::napi_get_value_double(env.raw(), value, &mut out) },
        "get_double_raw error"
    )?;
    Ok(out)
}

fn get_bigint_u64_raw(env: &Env, value: sys::napi_value) -> napi::Result<(u64, bool)> {
    let mut out = 0u64;
    let mut lossless = false;
    napi::check_status!(
        unsafe { sys::napi_get_value_bigint_uint64(env.raw(), value, &mut out, &mut lossless) },
        "get_bigint_u64_raw error"
    )?;
    Ok((out, lossless))
}

fn get_bigint_i64_raw(env: &Env, value: sys::napi_value) -> napi::Result<(i64, bool)> {
    let mut out = 0i64;
    let mut lossless = false;
    napi::check_status!(
        unsafe { sys::napi_get_value_bigint_int64(env.raw(), value, &mut out, &mut lossless) },
        "get_bigint_i64_raw error"
    )?;
    Ok((out, lossless))
}

fn get_property_raw(
    env: &Env,
    object: sys::napi_value,
    key: sys::napi_value,
) -> napi::Result<JsUnknown> {
    let mut raw_value = std::ptr::null_mut();
    napi::check_status!(
        unsafe { sys::napi_get_property(env.raw(), object, key, &mut raw_value) },
        "get_property_raw error"
    )?;
    Ok(unsafe { JsUnknown::from_raw_unchecked(env.raw(), raw_value) })
}

fn with_raw_utf8<T>(
    env: &Env,
    value: sys::napi_value,
    f: impl FnOnce(&str) -> napi::Result<T>,
) -> napi::Result<T> {
    let mut short_buf = [0u8; 128];
    let mut written = 0usize;
    napi::check_status!(
        unsafe {
            sys::napi_get_value_string_utf8(
                env.raw(),
                value,
                short_buf.as_mut_ptr().cast(),
                short_buf.len(),
                &mut written,
            )
        },
        "read short string error"
    )?;

    if written < short_buf.len() - 1 {
        let string =
            std::str::from_utf8(&short_buf[..written]).map_err(|_| invalid_arg("invalid utf-8"))?;
        return f(string);
    }

    let mut len = 0usize;
    napi::check_status!(
        unsafe {
            sys::napi_get_value_string_utf8(env.raw(), value, std::ptr::null_mut(), 0, &mut len)
        },
        "get string length error"
    )?;

    let mut buf = vec![0u8; len + 1];
    let mut written = 0usize;
    napi::check_status!(
        unsafe {
            sys::napi_get_value_string_utf8(
                env.raw(),
                value,
                buf.as_mut_ptr().cast(),
                buf.len(),
                &mut written,
            )
        },
        "read string error"
    )?;
    let string = std::str::from_utf8(&buf[..written]).map_err(|_| invalid_arg("invalid utf-8"))?;
    f(string)
}

fn read_length_prefixed_slice<'a>(reader: &mut Reader<'a>) -> napi::Result<&'a [u8]> {
    let len = reader
        .read_varuint()
        .map_err(|e| invalid_arg(&e.to_string()))? as usize;
    reader
        .read_exact(len)
        .map_err(|e| invalid_arg(&e.to_string()))
}

fn read_native_str<'a>(reader: &mut Reader<'a>) -> napi::Result<&'a str> {
    let bytes = read_length_prefixed_slice(reader)?;
    std::str::from_utf8(bytes).map_err(|_| invalid_arg("invalid utf-8"))
}

fn write_smallest_u64(value: u64, out: &mut Vec<u8>) {
    if u8::try_from(value).is_ok() {
        out.push(1);
        out.push(value as u8);
    } else if u16::try_from(value).is_ok() {
        out.push(2);
        out.extend_from_slice(&(value as u16).to_le_bytes());
    } else if u32::try_from(value).is_ok() {
        out.push(4);
        out.extend_from_slice(&(value as u32).to_le_bytes());
    } else {
        out.push(8);
        out.extend_from_slice(&value.to_le_bytes());
    }
}

fn read_smallest_u64(reader: &mut Reader<'_>) -> recurram_core::Result<u64> {
    match reader.read_u8()? {
        1 => Ok(reader.read_u8()? as u64),
        2 => {
            let mut bytes = [0u8; 2];
            bytes.copy_from_slice(reader.read_exact(2)?);
            Ok(u16::from_le_bytes(bytes) as u64)
        }
        4 => {
            let mut bytes = [0u8; 4];
            bytes.copy_from_slice(reader.read_exact(4)?);
            Ok(u32::from_le_bytes(bytes) as u64)
        }
        8 => {
            let mut bytes = [0u8; 8];
            bytes.copy_from_slice(reader.read_exact(8)?);
            Ok(u64::from_le_bytes(bytes))
        }
        _ => Err(recurram_core::RecurramError::InvalidData(
            "smallest-width integer size",
        )),
    }
}

fn encode_native_root_message(env: &Env, value: JsUnknown, out: &mut Vec<u8>) -> napi::Result<()> {
    match value.get_type()? {
        ValueType::Object => {
            let object = unsafe { value.cast::<JsObject>() };
            let object_raw = unsafe { object.raw() };
            if is_array_raw(env, object_raw)? {
                out.push(MESSAGE_ARRAY);
                let length = get_array_length_raw(env, object_raw)? as usize;
                encode_varuint(length as u64, out);
                for index in 0..length {
                    let item = get_element_raw(env, object_raw, index as u32)?;
                    write_native_value(env, item, out)?;
                }
                Ok(())
            } else if is_buffer_raw(env, object_raw)?
                || is_typedarray_raw(env, object_raw)?
                || is_dataview_raw(env, object_raw)?
                || is_date_raw(env, object_raw)?
            {
                out.push(MESSAGE_SCALAR);
                write_native_value(env, value, out)
            } else {
                out.push(MESSAGE_MAP);
                write_native_root_map(env, object, out)
            }
        }
        _ => {
            out.push(MESSAGE_SCALAR);
            write_native_value(env, value, out)
        }
    }
}

fn write_native_root_map(env: &Env, object: JsObject, out: &mut Vec<u8>) -> napi::Result<()> {
    let property_names = own_enumerable_property_names(&object)?;
    let property_names_raw = unsafe { property_names.raw() };
    let object_raw = unsafe { object.raw() };
    let property_count = get_array_length_raw(env, property_names_raw)? as usize;
    encode_varuint(property_count as u64, out);
    for index in 0..property_count {
        let key = get_element_raw(env, property_names_raw, index as u32)?;
        let key_raw = unsafe { key.raw() };
        let item = get_property_raw(env, object_raw, key_raw)?;
        with_raw_utf8(env, key_raw, |name| {
            out.push(KEY_LITERAL);
            write_map_key_fast(name, out);
            write_native_value(env, item, out)
        })?;
    }
    Ok(())
}

fn write_plain_object_map(env: &Env, object: JsObject, out: &mut Vec<u8>) -> napi::Result<()> {
    let property_names = own_enumerable_property_names(&object)?;
    let property_names_raw = unsafe { property_names.raw() };
    let object_raw = unsafe { object.raw() };
    let property_count = get_array_length_raw(env, property_names_raw)? as usize;
    encode_varuint(property_count as u64, out);
    for index in 0..property_count {
        let key = get_element_raw(env, property_names_raw, index as u32)?;
        let key_raw = unsafe { key.raw() };
        let item = get_property_raw(env, object_raw, key_raw)?;
        with_raw_utf8(env, key_raw, |name| {
            write_map_key_fast(name, out);
            write_native_value(env, item, out)
        })?;
    }
    Ok(())
}

fn write_native_value(env: &Env, value: JsUnknown, out: &mut Vec<u8>) -> napi::Result<()> {
    match value.get_type()? {
        ValueType::Null => {
            out.push(TAG_NULL);
            Ok(())
        }
        ValueType::Undefined => Err(invalid_arg("undefined is not supported")),
        ValueType::Boolean => {
            let value_raw = unsafe { value.raw() };
            out.push(if get_bool_raw(env, value_raw)? {
                TAG_BOOL_TRUE
            } else {
                TAG_BOOL_FALSE
            });
            Ok(())
        }
        ValueType::Number => {
            let value_raw = unsafe { value.raw() };
            write_native_number(env, value_raw, out)
        }
        ValueType::String => {
            let value_raw = unsafe { value.raw() };
            with_raw_utf8(env, value_raw, |string| {
                out.push(TAG_STRING);
                if string.is_empty() {
                    out.push(STRING_EMPTY);
                } else {
                    out.push(STRING_LITERAL);
                    append_cached_string_value(string, out);
                }
                Ok(())
            })
        }
        ValueType::BigInt => {
            let value_raw = unsafe { value.raw() };
            write_native_bigint(env, value_raw, out)
        }
        ValueType::Object => {
            let object = unsafe { value.cast::<JsObject>() };
            let object_raw = unsafe { object.raw() };
            if is_array_raw(env, object_raw)? {
                let length = get_array_length_raw(env, object_raw)? as usize;
                out.push(TAG_ARRAY);
                encode_varuint(length as u64, out);
                for index in 0..length {
                    let item = get_element_raw(env, object_raw, index as u32)?;
                    write_native_value(env, item, out)?;
                }
                return Ok(());
            }

            if is_buffer_raw(env, object_raw)? {
                let buffer = unsafe { value.cast::<JsBuffer>() };
                let bytes = buffer.into_value()?;
                out.push(TAG_BINARY);
                encode_varuint(bytes.len() as u64, out);
                out.extend_from_slice(bytes.as_ref());
                return Ok(());
            }

            if is_typedarray_raw(env, object_raw)? {
                let typed_array = unsafe { value.cast::<JsTypedArray>() }.into_value()?;
                return match typed_array.typedarray_type {
                    TypedArrayType::Uint8 | TypedArrayType::Uint8Clamped => {
                        let bytes = AsRef::<[u8]>::as_ref(&typed_array);
                        out.push(TAG_BINARY);
                        encode_varuint(bytes.len() as u64, out);
                        out.extend_from_slice(bytes);
                        Ok(())
                    }
                    _ => Err(invalid_arg("unsupported typed array; use Uint8Array")),
                };
            }

            if is_dataview_raw(env, object_raw)? || is_date_raw(env, object_raw)? {
                return Err(invalid_arg("unsupported value type"));
            }

            out.push(TAG_MAP);
            write_plain_object_map(env, object, out)
        }
        _ => Err(invalid_arg("unsupported value type")),
    }
}

fn write_native_number(
    env: &Env,
    value_raw: sys::napi_value,
    out: &mut Vec<u8>,
) -> napi::Result<()> {
    let value = get_double_raw(env, value_raw)?;
    if !value.is_finite() {
        return Err(invalid_arg("number values must be finite"));
    }
    if value.fract() == 0.0 {
        if value.abs() > MAX_SAFE_INTEGER_F64 {
            return Err(invalid_arg(
                "unsafe integer number detected; use bigint for 64-bit integers",
            ));
        }
        if value >= 0.0 {
            out.push(TAG_U64);
            write_smallest_u64(value as u64, out);
        } else {
            out.push(TAG_I64);
            write_smallest_u64(encode_zigzag(value as i64), out);
        }
    } else {
        out.push(TAG_F64);
        out.extend_from_slice(&value.to_le_bytes());
    }
    Ok(())
}

fn write_native_bigint(
    env: &Env,
    value_raw: sys::napi_value,
    out: &mut Vec<u8>,
) -> napi::Result<()> {
    let (unsigned, unsigned_lossless) = get_bigint_u64_raw(env, value_raw)?;
    if unsigned_lossless {
        out.push(TAG_U64);
        write_smallest_u64(unsigned, out);
        return Ok(());
    }

    let (signed, signed_lossless) = get_bigint_i64_raw(env, value_raw)?;
    if signed_lossless {
        out.push(TAG_I64);
        write_smallest_u64(encode_zigzag(signed), out);
        return Ok(());
    }

    Err(invalid_arg("bigint value is out of range for recurram"))
}

fn value_to_js_unknown(env: &Env, value: Value) -> napi::Result<JsUnknown> {
    match value {
        Value::Null => Ok(env.get_null()?.into_unknown()),
        Value::Bool(v) => Ok(env.get_boolean(v)?.into_unknown()),
        Value::I64(v) => Ok(env.create_bigint_from_i64(v)?.into_unknown()?),
        Value::U64(v) => Ok(env.create_bigint_from_u64(v)?.into_unknown()?),
        Value::F64(v) => Ok(env.create_double(v)?.into_unknown()),
        Value::String(v) => Ok(env.create_string_from_std(v)?.into_unknown()),
        Value::Binary(v) => Ok(env.create_buffer_with_data(v)?.into_unknown()),
        Value::Array(values) => {
            let mut array = env.create_array_with_length(values.len())?;
            for (index, item) in values.into_iter().enumerate() {
                array.set_element(index as u32, value_to_js_unknown(env, item)?)?;
            }
            Ok(array.into_unknown())
        }
        Value::Map(entries) => {
            let mut object = env.create_object()?;
            for (key, value) in entries {
                set_named_property_cached(
                    env,
                    &mut object,
                    &key,
                    value_to_js_unknown(env, value)?,
                )?;
            }
            Ok(object.into_unknown())
        }
    }
}

fn try_decode_native_root_message(env: &Env, bytes: &[u8]) -> napi::Result<Option<JsUnknown>> {
    let mut reader = Reader::new(bytes);
    let decoded = match reader.read_u8() {
        Ok(MESSAGE_SCALAR) => {
            let value = read_native_value(env, &mut reader)?;
            let Some(value) = value else {
                return Ok(None);
            };
            Some(unsafe { JsUnknown::from_raw_unchecked(env.raw(), value) })
        }
        Ok(MESSAGE_ARRAY) => {
            let length = reader
                .read_varuint()
                .map_err(|e| invalid_arg(&e.to_string()))? as usize;
            let array = create_array_with_length_raw(env, length)?;
            for index in 0..length {
                let value = read_native_value(env, &mut reader)?;
                let Some(value) = value else {
                    return Ok(None);
                };
                set_element_raw(env, &array, index as u32, value)?;
            }
            Some(array.into_unknown())
        }
        Ok(MESSAGE_MAP) => {
            let length = reader
                .read_varuint()
                .map_err(|e| invalid_arg(&e.to_string()))? as usize;
            let object = create_object_raw(env)?;
            for _ in 0..length {
                let mode = reader.read_u8().map_err(|e| invalid_arg(&e.to_string()))?;
                if mode != KEY_LITERAL {
                    return Ok(None);
                }
                let key = read_native_str(&mut reader)?;
                let value = read_native_value(env, &mut reader)?;
                let Some(value) = value else {
                    return Ok(None);
                };
                set_named_property_fast(env, &object, key, value)?;
            }
            Some(object.into_unknown())
        }
        Ok(_) => None,
        Err(error) => return Err(invalid_arg(&error.to_string())),
    };

    if !reader.is_eof() {
        return Ok(None);
    }
    Ok(decoded)
}

fn read_native_value(env: &Env, reader: &mut Reader<'_>) -> napi::Result<Option<sys::napi_value>> {
    match reader.read_u8().map_err(|e| invalid_arg(&e.to_string()))? {
        TAG_NULL => create_null_raw(env).map(Some),
        TAG_BOOL_FALSE => create_boolean_raw(env, false).map(Some),
        TAG_BOOL_TRUE => create_boolean_raw(env, true).map(Some),
        TAG_I64 => {
            let value =
                decode_zigzag(read_smallest_u64(reader).map_err(|e| invalid_arg(&e.to_string()))?);
            create_bigint_i64_value_raw(env, value).map(Some)
        }
        TAG_U64 => {
            let value = read_smallest_u64(reader).map_err(|e| invalid_arg(&e.to_string()))?;
            if value <= MAX_I64_AS_U64 {
                create_bigint_i64_value_raw(env, value as i64).map(Some)
            } else {
                create_bigint_u64_value_raw(env, value).map(Some)
            }
        }
        TAG_F64 => {
            let mut bytes = [0u8; 8];
            bytes.copy_from_slice(
                reader
                    .read_exact(8)
                    .map_err(|e| invalid_arg(&e.to_string()))?,
            );
            create_double_value_raw(env, f64::from_le_bytes(bytes)).map(Some)
        }
        TAG_STRING => match reader.read_u8().map_err(|e| invalid_arg(&e.to_string()))? {
            STRING_EMPTY => create_string_raw(env, "").map(Some),
            STRING_LITERAL => {
                let value = read_length_prefixed_slice(reader)?;
                if value.is_ascii() {
                    create_string_bytes_raw(env, value).map(Some)
                } else {
                    let value =
                        std::str::from_utf8(value).map_err(|_| invalid_arg("invalid utf-8"))?;
                    create_string_raw(env, value).map(Some)
                }
            }
            _ => Ok(None),
        },
        TAG_BINARY => {
            let bytes = read_length_prefixed_slice(reader)?;
            create_buffer_copy_raw(env, bytes).map(Some)
        }
        TAG_ARRAY => {
            let length = reader
                .read_varuint()
                .map_err(|e| invalid_arg(&e.to_string()))? as usize;
            let array = create_array_with_length_raw(env, length)?;
            for index in 0..length {
                let value = read_native_value(env, reader)?;
                let Some(value) = value else {
                    return Ok(None);
                };
                set_element_raw(env, &array, index as u32, value)?;
            }
            Ok(Some(unsafe { array.raw() }))
        }
        TAG_MAP => {
            let length = reader
                .read_varuint()
                .map_err(|e| invalid_arg(&e.to_string()))? as usize;
            let object = create_object_raw(env)?;
            for _ in 0..length {
                let key = read_native_str(reader)?;
                let value = read_native_value(env, reader)?;
                let Some(value) = value else {
                    return Ok(None);
                };
                set_named_property_fast(env, &object, key, value)?;
            }
            Ok(Some(unsafe { object.raw() }))
        }
        _ => Ok(None),
    }
}

#[napi(js_name = "encodeNative")]
pub fn encode_native_napi(env: Env, value: JsUnknown) -> napi::Result<Buffer> {
    let mut out = Vec::with_capacity(256);
    encode_native_root_message(&env, value, &mut out)?;
    Ok(Buffer::from(out))
}

#[napi(js_name = "decodeNative")]
pub fn decode_native_napi(env: Env, bytes: &[u8]) -> napi::Result<JsUnknown> {
    if let Some(value) = try_decode_native_root_message(&env, bytes)? {
        return Ok(value);
    }
    let value = decode_value(bytes).map_err(|e| invalid_arg(&e.to_string()))?;
    value_to_js_unknown(&env, value)
}

// ── JSON-string based API (now using simd-json for parsing) ─────────────────

#[napi(js_name = "encodeTransportJson")]
pub fn encode_transport_json_napi(value_json: String) -> napi::Result<Buffer> {
    encode_transport_json(value_json)
        .map(Buffer::from)
        .map_err(to_napi_error)
}

#[napi(js_name = "decodeToTransportJson")]
pub fn decode_to_transport_json_napi(bytes: &[u8]) -> napi::Result<String> {
    decode_to_transport_json(bytes).map_err(to_napi_error)
}

#[napi(js_name = "decodeToCompactJson")]
pub fn decode_to_compact_json_napi(bytes: &[u8]) -> napi::Result<String> {
    decode_to_compact_json(bytes).map_err(to_napi_error)
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
pub fn decode_direct_napi(bytes: &[u8]) -> napi::Result<serde_json::Value> {
    let transport = decode_direct(bytes).map_err(to_napi_error)?;
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
