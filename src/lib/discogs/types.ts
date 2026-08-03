export interface DiscogsPagination {
  page: number;
  pages: number;
  per_page: number;
  items: number;
}

export interface DiscogsBasicInformation {
  id: number;
  title: string;
  year: number;
  thumb: string;
  cover_image: string;
  formats: { name: string; qty: string; descriptions?: string[] }[];
  artists: { id: number; name: string; join?: string; role?: string }[];
  genres?: string[];
  styles?: string[];
  labels?: { name: string; catno?: string }[];
}

export interface DiscogsCollectionItem {
  id: number; // release id
  instance_id: number;
  date_added: string;
  basic_information: DiscogsBasicInformation;
}

export interface DiscogsCollectionResponse {
  pagination: DiscogsPagination;
  releases: DiscogsCollectionItem[];
}

export interface DiscogsTrack {
  position: string;
  type_: string;
  title: string;
  duration?: string; // "3:45"
  artists?: { id: number; name: string }[];
}

export interface DiscogsReleaseDetail {
  id: number;
  title: string;
  year: number;
  notes?: string;
  genres?: string[];
  styles?: string[];
  artists: { id: number; name: string; join?: string; role?: string }[];
  tracklist: DiscogsTrack[];
  community?: {
    rating?: { average: number; count: number };
  };
}
