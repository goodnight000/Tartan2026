# Chatbot E2E Smoke Report

- Timestamp (UTC): `2026-02-07T19:50:20.413791+00:00`
- CAREBASE_ONLY: `false`
- CAREPILOT_DISABLE_EXTERNAL_WEB: `false`
- Total scenarios: `3`
- Passed: `3`
- Failed: `0`

## Scenario Results

### PASS - Lab Discovery Planning
- Expected tool: `lab_clinic_discovery`
- Actual tool: `lab_clinic_discovery`
- Chat status code: `200`
- Execute status code: `200`
- Action lifecycle status: `succeeded`
- Chat preview: `I can help book that using live nearby discovery, but I need your location first. Share your city or ZIP code, and I will find and rank real labs/clinics.`
- Action plan payload:
```json
{
  "tier": 1,
  "tool": "lab_clinic_discovery",
  "params": {
    "zip_or_geo": "Pittsburgh",
    "max_distance_miles": 10,
    "budget_cap": 120,
    "preferred_time_window": "next_available",
    "in_network_preference": "prefer_in_network"
  },
  "consent_prompt": "I can find and rank nearby labs and clinics. Proceed?"
}
```
- Execute response payload:
```json
{
  "status": "success",
  "result": {
    "options": [
      {
        "name": "Quest Diagnostics",
        "distance_miles": 2.1,
        "price_range": "$70-$95",
        "next_slot": "Sun 05:50 PM",
        "rating": 4.4,
        "rank_score": 0.7522,
        "network_match_hint": "in_network",
        "rank_reason": "distance=0.21, price=0.34, wait=0.31, rating_penalty=0.12, network_penalty=0.00",
        "criteria": {
          "max_distance_miles": 10.0,
          "budget_cap": 120.0,
          "preferred_time_window": "next_available",
          "origin": "Pittsburgh",
          "provider": "fallback_static"
        },
        "address": "Pittsburgh",
        "source_url": null,
        "contact_phone": null,
        "data_source": "fallback_static"
      },
      {
        "name": "Riverside Clinic Lab",
        "distance_miles": 4.4,
        "price_range": "$65-$102",
        "next_slot": "Sun 01:50 PM",
        "rating": 4.2,
        "rank_score": 0.6805,
        "network_match_hint": "in_network",
        "rank_reason": "distance=0.44, price=0.35, wait=0.25, rating_penalty=0.16, network_penalty=0.00",
        "criteria": {
          "max_distance_miles": 10.0,
          "budget_cap": 120.0,
          "preferred_time_window": "next_available",
          "origin": "Pittsburgh",
          "provider": "fallback_static"
        },
        "address": "Pittsburgh",
        "source_url": null,
        "contact_phone": null,
        "data_source": "fallback_static"
      },
      {
        "name": "Labcorp Midtown",
        "distance_miles": 3.0,
        "price_range": "$60-$110",
        "next_slot": "Mon 01:50 AM",
        "rating": 4.1,
        "rank_score": 0.6593,
        "network_match_hint": "unknown",
        "rank_reason": "distance=0.30, price=0.35, wait=0.42, rating_penalty=0.18, network_penalty=0.50",
        "criteria": {
          "max_distance_miles": 10.0,
          "budget_cap": 120.0,
          "preferred_time_window": "next_available",
          "origin": "Pittsburgh",
          "provider": "fallback_static"
        },
        "address": "Pittsburgh",
        "source_url": null,
        "contact_phone": null,
        "data_source": "fallback_static"
      },
      {
        "name": "City Health Lab",
        "distance_miles": 1.8,
        "price_range": "$85-$120",
        "next_slot": "Mon 11:50 AM",
        "rating": 4.7,
        "rank_score": 0.6353,
        "network_match_hint": "out_of_network",
        "rank_reason": "distance=0.18, price=0.43, wait=0.56, rating_penalty=0.06, network_penalty=1.00",
        "criteria": {
          "max_distance_miles": 10.0,
          "budget_cap": 120.0,
          "preferred_time_window": "next_available",
          "origin": "Pittsburgh",
          "provider": "fallback_static"
        },
        "address": "Pittsburgh",
        "source_url": null,
        "contact_phone": null,
        "data_source": "fallback_static"
      },
      {
        "name": "Metro Family Diagnostics",
        "distance_miles": 5.2,
        "price_range": "$55-$90",
        "next_slot": "Sun 11:50 PM",
        "rating": 3.9,
        "rank_score": 0.5983,
        "network_match_hint": "unknown",
        "rank_reason": "distance=0.52, price=0.30, wait=0.39, rating_penalty=0.22, network_penalty=0.50",
        "criteria": {
          "max_distance_miles": 10.0,
          "budget_cap": 120.0,
          "preferred_time_window": "next_available",
          "origin": "Pittsburgh",
          "provider": "fallback_static"
        },
        "address": "Pittsburgh",
        "source_url": null,
        "contact_phone": null,
        "data_source": "fallback_static"
      }
    ],
    "provider": "fallback_static",
    "using_live_data": false,
    "fallback_reason": "no_live_results",
    "items": [
      {
        "name": "Quest Diagnostics",
        "address": "Pittsburgh",
        "distance_m": 2.1,
        "hours": "Sun 05:50 PM",
        "rank_score": 0.7522,
        "rank_reason": "distance=0.21, price=0.34, wait=0.31, rating_penalty=0.12, network_penalty=0.00",
        "network_match_hint": "in_network",
        "source_url": null,
        "contact_phone": null,
        "data_source": "fallback_static"
      },
      {
        "name": "Riverside Clinic Lab",
        "address": "Pittsburgh",
        "distance_m": 4.4,
        "hours": "Sun 01:50 PM",
        "rank_score": 0.6805,
        "rank_reason": "distance=0.44, price=0.35, wait=0.25, rating_penalty=0.16, network_penalty=0.00",
        "network_match_hint": "in_network",
        "source_url": null,
        "contact_phone": null,
        "data_source": "fallback_static"
      },
      {
        "name": "Labcorp Midtown",
        "address": "Pittsburgh",
        "distance_m": 3.0,
        "hours": "Mon 01:50 AM",
        "rank_score": 0.6593,
        "rank_reason": "distance=0.30, price=0.35, wait=0.42, rating_penalty=0.18, network_penalty=0.50",
        "network_match_hint": "unknown",
        "source_url": null,
        "contact_phone": null,
        "data_source": "fallback_static"
      },
      {
        "name": "City Health Lab",
        "address": "Pittsburgh",
        "distance_m": 1.8,
        "hours": "Mon 11:50 AM",
        "rank_score": 0.6353,
        "rank_reason": "distance=0.18, price=0.43, wait=0.56, rating_penalty=0.06, network_penalty=1.00",
        "network_match_hint": "out_of_network",
        "source_url": null,
        "contact_phone": null,
        "data_source": "fallback_static"
      },
      {
        "name": "Metro Family Diagnostics",
        "address": "Pittsburgh",
        "distance_m": 5.2,
        "hours": "Sun 11:50 PM",
        "rank_score": 0.5983,
        "rank_reason": "distance=0.52, price=0.30, wait=0.39, rating_penalty=0.22, network_penalty=0.50",
        "network_match_hint": "unknown",
        "source_url": null,
        "contact_phone": null,
        "data_source": "fallback_static"
      }
    ],
    "errors": [],
    "lifecycle": [
      "planned",
      "executing",
      "succeeded"
    ],
    "action_id": "876a160393084aee86472a4422d9f4ee",
    "message": null
  }
}
```

### PASS - Appointment Booking With Confirmation
- Expected tool: `appointment_book`
- Actual tool: `appointment_book`
- Chat status code: `200`
- Execute status code: `200`
- Action lifecycle status: `pending`
- Chat preview: `I have what I need. I can book with Quest Diagnostics at Pittsburgh for Tue Feb 10 09:00 AM. Confirm to execute.`
- Action plan payload:
```json
{
  "tier": 2,
  "tool": "appointment_book",
  "params": {
    "provider_name": "Quest Diagnostics",
    "slot_datetime": "2026-02-10T09:00:00Z",
    "location": "Pittsburgh",
    "mode": "live",
    "idempotency_key": "19aaed534f13400095c744f62002f1d5",
    "phone": "+914125551212",
    "email": "jane@example.com",
    "full_name": "Jane Doe",
    "booking_url": "https://book.health-example.com/appointments",
    "consent_token": "ctk_21b4965acdef45bdb6e314a9af5776bc",
    "payload_hash": "c1561a6ddbb0115959d7f31b493a82fa32775d79d41a6ba75be943de27d64195"
  },
  "consent_prompt": "I have what I need. I can book with Quest Diagnostics at Pittsburgh for Tue Feb 10 09:00 AM. Confirm to execute."
}
```
- Execute response payload:
```json
{
  "status": "success",
  "result": {
    "appointment_id": "apt_1e441f3e8e13",
    "provider_name": "Quest Diagnostics",
    "location": "Pittsburgh",
    "slot_datetime": "2026-02-10T09:00:00Z",
    "execution_mode": "live",
    "booking_url": "https://book.health-example.com/appointments",
    "lifecycle_transition": "executing->pending",
    "confirmation_artifact": {
      "external_ref": null,
      "sim_ref": null
    },
    "automation": {},
    "missing_fields": [
      "booking_url"
    ],
    "summary": "Booking request submitted",
    "errors": [
      {
        "code": "web_automation_pending",
        "message": "A valid booking/purchase URL is required for live browser automation."
      }
    ],
    "lifecycle": [
      "planned",
      "awaiting_confirmation",
      "executing",
      "pending"
    ],
    "action_id": "8ff68d760fd24e69bfb4b24a0a7c4d55",
    "message": "A valid booking/purchase URL is required for live browser automation."
  }
}
```

### PASS - Medical Purchase With Confirmation
- Expected tool: `medical_purchase`
- Actual tool: `medical_purchase`
- Chat status code: `200`
- Execute status code: `200`
- Action lifecycle status: `pending`
- Chat preview: `I can prepare this medical purchase action with a confirmation checkpoint before final submission.`
- Action plan payload:
```json
{
  "tier": 2,
  "tool": "medical_purchase",
  "params": {
    "item_name": "1 medical pulse oximeter",
    "quantity": 1,
    "purchase_url": "https://shop.health-example.com/checkout",
    "mode": "live",
    "idempotency_key": "ff6e3f36b012434eb8bbc74a7ac37077",
    "full_name": "Jane Doe",
    "email": "jane@example.com",
    "phone": "+914125551212",
    "consent_token": "ctk_80e051beeb934408b93b3a2b51f8dd1b",
    "payload_hash": "c22d2b217b7e2f3b449fee42ae4e2d0d1917e3842910aa9379e164f180bf3283"
  },
  "consent_prompt": "I can execute this medical purchase workflow after your confirmation. Proceed?"
}
```
- Execute response payload:
```json
{
  "status": "success",
  "result": {
    "purchase_id": "pur_7e206809c97f",
    "item_name": "1 medical pulse oximeter",
    "quantity": 1,
    "purchase_url": "https://shop.health-example.com/checkout",
    "execution_mode": "live",
    "lifecycle_transition": "executing->pending",
    "confirmation_artifact": {
      "external_ref": null,
      "sim_ref": null
    },
    "automation": {},
    "missing_fields": [
      "purchase_url"
    ],
    "summary": "Purchase request submitted",
    "errors": [
      {
        "code": "web_automation_pending",
        "message": "A valid booking/purchase URL is required for live browser automation."
      }
    ],
    "lifecycle": [
      "planned",
      "awaiting_confirmation",
      "executing",
      "pending"
    ],
    "action_id": "51008e66a5ee416cba362a683b4e5fd2",
    "message": "A valid booking/purchase URL is required for live browser automation."
  }
}
```
