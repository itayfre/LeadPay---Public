import { useTranslation } from 'react-i18next';
import { STATUS_VISUALS, type BuildingStatus } from '../../lib/buildingStatus';

interface Props {
  status: BuildingStatus;
}

export default function StatusBadge({ status }: Props) {
  const { t } = useTranslation();
  const v = STATUS_VISUALS[status];
  const key = `buildings.status.${status}`;
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${v.textClass} ${v.bgClass} px-2 py-0.5 rounded-full whitespace-nowrap`}>
      <span className={`w-1.5 h-1.5 rounded-full ${v.dotClass}`} />
      {t(key)}
    </span>
  );
}
