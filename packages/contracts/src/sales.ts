export interface SaleRecord {
  transactionId: string;
  inspireIds: string[];
  price: number;
  date: string;
  address: string;
  propertyType: string;
  newBuild: boolean;
  category: string;
}

export interface SalesRelease {
  period: string;
  importedAt: string;
  pilotSha256: string;
  sources: { url: string; sha256: string }[];
  attribution: string;
  licence: string;
  addressConditions: string;
  records: SaleRecord[];
}

export function salesForParcel(release: SalesRelease | undefined, inspireId: string): SalesRelease | undefined {
  return salesForParcels(release, [inspireId]);
}

export function salesForParcels(release: SalesRelease | undefined, inspireIds: string[]): SalesRelease | undefined {
  return release && { ...release, records: release.records.filter(record => record.inspireIds.some(inspireId => inspireIds.includes(inspireId))) };
}