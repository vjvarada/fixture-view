import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface SupportsPanelProps {
  open: boolean;
  onClose: () => void;
}

const SupportsPanel: React.FC<SupportsPanelProps> = ({ open, onClose }) => {
  const [type, setType] = React.useState<'rectangular' | 'cylindrical' | 'conical' | 'custom'>('cylindrical');

  if (!open) return null;

  const startPlacement = () => {
    window.dispatchEvent(new CustomEvent('supports-start-placement', {
      detail: { type, params: {} }
    }));
  };

  return (
    <div className="absolute left-16 top-16 z-40">
      <Card className="w-80">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Create Supports</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Tabs value={type} onValueChange={(v) => setType(v as any)}>
            <TabsList className="grid grid-cols-4">
              <TabsTrigger value="rectangular">Rect</TabsTrigger>
              <TabsTrigger value="cylindrical">Cyl</TabsTrigger>
              <TabsTrigger value="conical">Cone</TabsTrigger>
              <TabsTrigger value="custom">Custom</TabsTrigger>
            </TabsList>
          </Tabs>

          <p className="text-xs text-muted-foreground">Click center  drag to size  click/drag up to set height. No manual input.</p>

          <div className="flex gap-2 pt-1">
            <Button size="sm" className="flex-1" onClick={startPlacement}>Select</Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                window.dispatchEvent(new CustomEvent('supports-start-placement', {
                  detail: { type, params: {} }
                }));
              }}
            >
              Restart
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => window.dispatchEvent(new Event('supports-cancel-placement'))}
            >
              Cancel
            </Button>
            <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default SupportsPanel;
