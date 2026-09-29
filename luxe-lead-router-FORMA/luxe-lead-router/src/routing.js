'use strict';
const zipcodes = require('zipcodes');
const installers = require('../data/installers.json');

const COVERAGE_MILES = Number(process.env.COVERAGE_MILES || 150);
const NEAREST_COUNT = 3;

function haversineMi(lat1, lng1, lat2, lng2) {
  const R = 3958.8, toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Resolve consumer location. US zip via offline table; anything else unresolved → no coverage.
function resolveLocation({ zip, country }) {
  const c = (country || 'US').toUpperCase();
  if (c === 'US' || c === 'USA') {
    const z = String(zip || '').trim().slice(0, 5);
    const r = zipcodes.lookup(z);
    if (r) return { lat: r.latitude, lng: r.longitude, city: r.city, state: r.state, country: 'US' };
  }
  return null;
}

function publicInstaller(i, distance) {
  return {
    id: i.id, name: i.name, tier: i.tier, address: i.address, city: i.city, state: i.state,
    zip: i.zip, country: i.country, phone: i.phone, website: i.website, hours: i.hours,
    lat: i.lat, lng: i.lng, distanceMi: distance == null ? null : Math.round(distance)
  };
}

function route(lead) {
  const loc = resolveLocation(lead);
  if (!loc) {
    return { covered: false, location: null, nearest: [], assigned: null, reason: 'location_unresolved' };
  }
  const ranked = installers
    .filter(i => i.lat != null && i.lng != null)
    .map(i => ({ i, d: haversineMi(loc.lat, loc.lng, i.lat, i.lng) }))
    .sort((a, b) => a.d - b.d);
  const nearest = ranked.slice(0, NEAREST_COUNT);
  const covered = nearest.length > 0 && nearest[0].d <= COVERAGE_MILES;
  // Assign to the single nearest installer that is inside coverage AND approved to receive consumer leads.
  const assignable = ranked.find(r => r.d <= COVERAGE_MILES && r.i.leadEmailApproved && r.i.leadEmail);
  return {
    covered,
    location: loc,
    nearest: nearest.map(r => publicInstaller(r.i, r.d)),
    assigned: assignable ? { ...publicInstaller(assignable.i, assignable.d), leadEmail: assignable.i.leadEmail } : null,
    reason: covered ? (assignable ? 'assigned' : 'covered_no_approved_email') : 'out_of_coverage'
  };
}

function priorityFor(year) {
  const y = parseInt(year, 10);
  return Number.isFinite(y) && y >= 2020 ? 'High (2020+)' : 'Standard (2019-)';
}

module.exports = { route, priorityFor, installers, publicInstaller, COVERAGE_MILES };
