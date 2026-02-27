import { ChevronDown, ChevronUp, PanelLeft, PanelLeftClose, PanelRight, PanelRightClose } from "lucide-react";
import { Button } from "../ui/button";

export function HorizontalSplitter({ collapsed, onResizeStart, onToggle }) {
  return (
    <div
      className={`relative my-1 h-3 rounded border bg-muted/30 ${collapsed ? "cursor-default" : "cursor-row-resize"}`}
      onMouseDown={() => {
        if (!collapsed) onResizeStart();
      }}
    >
      <Button
        size="icon"
        variant="outline"
        className="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full bg-background shadow-sm"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={onToggle}
      >
        {collapsed ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </Button>
    </div>
  );
}

export function VerticalSplitter({ collapsed, onResizeStart, onToggle }) {
  return (
    <div
      className={`relative min-h-0 h-full border-x bg-muted/30 ${collapsed ? "cursor-default" : "cursor-col-resize"}`}
      onMouseDown={() => !collapsed && onResizeStart()}
    >
      <Button
        size="icon"
        variant="outline"
        className="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full bg-background shadow-sm"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
      >
        {collapsed ? <PanelRight className="h-4 w-4" /> : <PanelRightClose className="h-4 w-4" />}
      </Button>
    </div>
  );
}

export function LeftVerticalSplitter({ collapsed, onResizeStart, onToggle }) {
  return (
    <div
      className={`relative min-h-0 h-full border-x bg-muted/30 ${collapsed ? "cursor-default" : "cursor-col-resize"}`}
      onMouseDown={() => !collapsed && onResizeStart()}
    >
      <Button
        size="icon"
        variant="outline"
        className="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full bg-background shadow-sm"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
      >
        {collapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
      </Button>
    </div>
  );
}
