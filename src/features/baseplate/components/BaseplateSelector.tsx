import React from 'react';

interface BaseplateSelectorProps {
  open: boolean;
  onClose: () => void;
  onSelect: (type: 'rectangular' | 'convex-hull' | 'perforated-panel' | 'metal-wooden-plate') => void;
}

const Card: React.FC<{ title: string; subtitle: string; icon?: React.ReactNode; children: React.ReactNode }>=({title, subtitle, icon, children})=> (
  <div style={{ border:'1px solid #e5e7eb', borderRadius:12, padding:16, background:'#fff' }}>
    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
      {icon}
      <div style={{ fontWeight:600, color:'#0f172a' }}>{title}</div>
    </div>
    <div style={{ color:'#64748b', fontSize:13, marginBottom:10 }}>{subtitle}</div>
    {children}
  </div>
);

const Select: React.FC<{ placeholder:string; options:{label:string,value:string,desc?:string}[]; onChange:(v:string)=>void }>=({placeholder, options, onChange})=> (
  <div style={{ position:'relative' }}>
    <select defaultValue="" onChange={(e)=> e.target.value && onChange(e.target.value)} style={{
      width:'100%', padding:'10px 12px', border:'1px solid #d1d5db', borderRadius:10, background:'#fff', color:'#111827'
    }}>
      <option value="" disabled>{placeholder}</option>
      {options.map(o=> (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  </div>
);

const BaseplateSelector: React.FC<BaseplateSelectorProps> = ({ open, onClose, onSelect }) => {
  if (!open) return null;
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(15,23,42,0.35)', display:'grid', placeItems:'center', zIndex:50 }}>
      <div style={{ width:720, background:'#fff', borderRadius:16, boxShadow:'0 10px 30px rgba(0,0,0,0.15)', padding:20 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
          <div>
            <div style={{ fontSize:18, fontWeight:700, color:'#0f172a' }}>Choose Base Plates</div>
            <div style={{ fontSize:13, color:'#64748b' }}>Select the type of baseplate for your fixture design</div>
          </div>
          <button onClick={onClose} style={{ border:'none', background:'transparent', fontSize:18, cursor:'pointer' }}>×</button>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
          <Card title="3D-Printed Baseplates" subtitle="Custom printed baseplates optimized for additive manufacturing" icon={<span style={{fontSize:18}}>📦</span>}>
            <div style={{ fontSize:12, color:'#0f172a', marginBottom:6 }}>Select Type:</div>
            <Select
              placeholder="Choose 3D-printed baseplate..."
              options={[
                { label:'Rectangular', value:'rectangular' },
                { label:'Convex Hull', value:'convex-hull' }
              ]}
              onChange={(v)=> onSelect(v as any)}
            />
          </Card>

          <Card title="Standard Components" subtitle="Traditional baseplate components and materials" icon={<span style={{fontSize:18}}>🧰</span>}>
            <div style={{ fontSize:12, color:'#0f172a', marginBottom:6 }}>Select Type:</div>
            <Select
              placeholder="Choose standard component..."
              options={[
                { label:'Perforated Panel', value:'perforated-panel' },
                { label:'Metal / Wooden Plate', value:'metal-wooden-plate' }
              ]}
              onChange={(v)=> onSelect(v as any)}
            />
          </Card>
        </div>

        <div style={{ display:'flex', justifyContent:'flex-end', marginTop:14 }}>
          <button onClick={onClose} style={{ padding:'8px 12px', border:'1px solid #e5e7eb', borderRadius:10, background:'#fff', cursor:'pointer' }}>Cancel</button>
        </div>
      </div>
    </div>
  );
};

export default BaseplateSelector;
