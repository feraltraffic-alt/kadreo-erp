import type { SiteLive, SiteLiveStatus } from "@kadreo/domain";
import { useI18n } from "@kadreo/i18n";
import { Button } from "@kadreo/ui";
import type { FeatureCollection, Geometry } from "geojson";
import maplibregl, { type Map as MlMap, type Marker } from "maplibre-gl";
import { Minus, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useNavigate } from "react-router";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import world from "world-atlas/countries-110m.json";

/**
 * Site map (11.1-12) on MapLibre GL without third-party tiles: country shapes ship with the app,
 * so worker and site coordinates never reach an external map provider (5.2).
 * Markers are grouped into clusters with a count when they would overlap at the current zoom.
 */

const STATUS_COLOR: Record<SiteLiveStatus, string> = { ok: "#12B76A", deviation: "#EAAA08", critical: "#E5484D" };
const HIGHLIGHT = new Set(["616", "276"]); // Poland, Germany

const countries = feature(world as unknown as Topology, (world as unknown as Topology).objects.countries as GeometryCollection) as unknown as FeatureCollection<Geometry, { name: string }>;

// Promote numeric ids to properties so the style expression can match them.
for (const f of countries.features) (f.properties as Record<string, unknown>).id = String(f.id);

const LABELS: { name: string; lng: number; lat: number }[] = [
  { name: "POLSKA", lng: 19.4, lat: 52.6 },
  { name: "DEUTSCHLAND", lng: 10.4, lat: 51.4 },
];

export function SitesMap({ sites, height = 340 }: { sites: SiteLive[]; height?: number }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markers = useRef<Marker[]>([]);
  const popup = useRef<maplibregl.Popup | null>(null);
  const [ready, setReady] = useState(false);
  const roots = useRef<Root[]>([]);

  useEffect(() => {
    if (!el.current) return;
    const map = new maplibregl.Map({
      container: el.current,
      style: {
        version: 8,
        sources: { countries: { type: "geojson", data: countries } },
        layers: [
          { id: "bg", type: "background", paint: { "background-color": "#F4F5F8" } },
          {
            id: "land",
            type: "fill",
            source: "countries",
            paint: { "fill-color": ["case", ["in", ["get", "id"], ["literal", [...HIGHLIGHT]]], "#E4E7EF", "#EDEFF3"] },
          },
          { id: "borders", type: "line", source: "countries", paint: { "line-color": "#C9CED8", "line-width": 1, "line-dasharray": [2, 2] } },
        ],
      },
      bounds: [
        [9.2, 48.9],
        [24.6, 55.1],
      ],
      fitBoundsOptions: { padding: 24 },
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      renderWorldCopies: false,
    });
    map.scrollZoom.setWheelZoomRate(1 / 300);
    map.on("load", () => setReady(true));
    for (const l of LABELS) {
      const node = document.createElement("div");
      node.className = "pointer-events-none text-[11px] font-semibold tracking-[0.14em] text-[#8A93A3]";
      node.textContent = l.name;
      new maplibregl.Marker({ element: node }).setLngLat([l.lng, l.lat]).addTo(map);
    }
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const render = () => {
      markers.current.forEach((m) => m.remove());
      roots.current.forEach((r) => queueMicrotask(() => r.unmount()));
      markers.current = [];
      roots.current = [];
      // Greedy screen-space clustering: 26 px radius.
      const pts = sites.map((s) => ({ s, p: map.project([s.lng, s.lat]) }));
      const used = new Set<number>();
      const groups: SiteLive[][] = [];
      pts.forEach((a, i) => {
        if (used.has(i)) return;
        const g = [a.s];
        used.add(i);
        pts.forEach((b, j) => {
          if (!used.has(j) && Math.hypot(a.p.x - b.p.x, a.p.y - b.p.y) < 26) {
            g.push(b.s);
            used.add(j);
          }
        });
        groups.push(g);
      });
      for (const g of groups) {
        const node = document.createElement("div");
        const root = createRoot(node);
        roots.current.push(root);
        if (g.length === 1) {
          const s = g[0]!;
          root.render(<SiteMarker status={s.status} label={s.siteName} onClick={() => openPopup(map, s)} />);
          markers.current.push(new maplibregl.Marker({ element: node }).setLngLat([s.lng, s.lat]).addTo(map));
        } else {
          const worst: SiteLiveStatus = g.some((s) => s.status === "critical") ? "critical" : g.some((s) => s.status === "deviation") ? "deviation" : "ok";
          const lng = g.reduce((a, s) => a + s.lng, 0) / g.length;
          const lat = g.reduce((a, s) => a + s.lat, 0) / g.length;
          root.render(
            <ClusterMarker
              count={g.length}
              status={worst}
              onClick={() => {
                const b = new maplibregl.LngLatBounds();
                g.forEach((s) => b.extend([s.lng, s.lat]));
                map.fitBounds(b, { padding: 70, maxZoom: 9, duration: 500 });
              }}
            />,
          );
          markers.current.push(new maplibregl.Marker({ element: node }).setLngLat([lng, lat]).addTo(map));
        }
      }
    };

    const openPopup = (m: MlMap, s: SiteLive) => {
      popup.current?.remove();
      const node = document.createElement("div");
      const root = createRoot(node);
      root.render(
        <div className="min-w-[200px] text-[13px]">
          <div className="text-[14px] font-bold">{s.siteName}</div>
          <div className="mt-0.5 text-white/80">
            {t("map.popup.fact", { actual: s.actual, planned: s.planned })} · {t("map.popup.noShows", { n: s.noShows })}
          </div>
          <button className="mt-2 font-semibold text-accent hover:underline" onClick={() => navigate(`/sites/${s.siteId}`)}>
            {t("map.open")} →
          </button>
        </div>,
      );
      popup.current = new maplibregl.Popup({ closeButton: false, offset: 16, className: "kadreo-popup", maxWidth: "280px" }).setLngLat([s.lng, s.lat]).setDOMContent(node).addTo(m);
      popup.current.on("close", () => queueMicrotask(() => root.unmount()));
    };

    render();
    map.on("zoomend", render);
    return () => {
      map.off("zoomend", render);
    };
  }, [sites, ready, t, navigate]);

  return (
    <div className="relative overflow-hidden rounded-[12px] border border-divider" style={{ height }} role="region" aria-label={t("map.aria")}>
      <div ref={el} className="h-full w-full" />
      <div className="absolute right-3 bottom-3 flex flex-col gap-2">
        <Button size="icon-sm" className="bg-surface shadow-card" aria-label={t("map.zoomIn")} onClick={() => mapRef.current?.zoomIn()}>
          <Plus className="size-4" />
        </Button>
        <Button size="icon-sm" className="bg-surface shadow-card" aria-label={t("map.zoomOut")} onClick={() => mapRef.current?.zoomOut()}>
          <Minus className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function SiteMarker({ status, label, onClick }: { status: SiteLiveStatus; label: string; onClick: () => void }) {
  const color = STATUS_COLOR[status];
  return (
    <button type="button" onClick={onClick} aria-label={label} className="relative flex size-5 items-center justify-center">
      {status === "critical" && <span className="absolute inset-0 animate-pulse-ring rounded-full" style={{ background: color }} />}
      <span className="relative size-4 rounded-full border-[3px] border-white shadow-[0_1px_4px_rgba(14,21,37,0.35)]" style={{ background: color, width: status === "critical" ? 20 : 16, height: status === "critical" ? 20 : 16 }} />
    </button>
  );
}

function ClusterMarker({ count, status, onClick }: { count: number; status: SiteLiveStatus; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex size-8 items-center justify-center rounded-full border-[3px] border-white text-[12px] font-bold text-white shadow-[0_1px_4px_rgba(14,21,37,0.35)]"
      style={{ background: STATUS_COLOR[status] }}
    >
      {count}
    </button>
  );
}
