import { useMemo, useState } from 'react';
import { LocateFixed, Radio, Truck } from 'lucide-react';
import type { Driver, DriverStatus, Order } from '@routepulse/shared';
import { LiveMap } from '../components/LiveMap';

const statuses: Array<'all' | DriverStatus> = ['all', 'available', 'busy', 'offline'];

export function FleetPage({ drivers, orders }: { drivers: Driver[]; orders: Order[] }) {
  const [filter, setFilter] = useState<'all' | DriverStatus>('all');
  const [selectedId, setSelectedId] = useState(drivers[0]?.id ?? '');
  const visible = useMemo(() => filter === 'all' ? drivers : drivers.filter(driver => driver.status === filter), [drivers, filter]);
  const selected = drivers.find(driver => driver.id === selectedId);

  return <section className="fleet-layout"><div className="panel fleet-map-panel"><div className="panel-head"><div><span className="eyebrow">Live positioning</span><h3>Fleet command map</h3></div><span className="live-dot"><i/>WebSocket live</span></div><LiveMap drivers={visible} orders={orders} selectedDriverId={selectedId} onDriverSelect={driver => setSelectedId(driver.id)}/></div><div className="panel fleet-roster"><div className="panel-head"><div><span className="eyebrow">Drivers</span><h3>{visible.length} vehicles shown</h3></div><Truck/></div><div className="filter-chips">{statuses.map(status => <button type="button" className={filter === status ? 'active' : ''} key={status} onClick={() => setFilter(status)}>{status}</button>)}</div><div className="driver-roster">{visible.map(driver => <button type="button" key={driver.id} className={selectedId === driver.id ? 'selected' : ''} onClick={() => setSelectedId(driver.id)}><span className="driver-avatar">{driver.name[0]}</span><span><strong>{driver.name}</strong><small><Radio/>{driver.status} · {new Date(driver.lastSeenAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small></span><b>{driver.capacityKg} kg</b></button>)}</div>{selected && <div className="driver-detail"><span className="eyebrow">Selected vehicle</span><strong>{selected.name}</strong><p><LocateFixed/>{selected.location.lat.toFixed(5)}, {selected.location.lng.toFixed(5)}</p><small>{selected.status === 'offline' ? 'Last known location' : 'Receiving live location updates'}</small></div>}</div></section>;
}
