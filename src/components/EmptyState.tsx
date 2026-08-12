import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";
import { tReportText } from "@/lib/report-i18n-rules";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  const { lang } = useI18n();
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
        <Icon className="h-10 w-10 text-muted-foreground" />
        <div>
          <p className="font-medium">{tReportText(title, lang)}</p>
          {description && (
            <p className="mt-1 text-sm text-muted-foreground">{tReportText(description, lang)}</p>
          )}
        </div>
        {action}
      </CardContent>
    </Card>
  );
}
