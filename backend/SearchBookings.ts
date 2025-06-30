// components/SearchBookings.tsx
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';

interface SearchProps {
  onSearch: (query: { room?: string; date?: Date; time?: string }) => void;
}

export const SearchBookings = ({ onSearch }: SearchProps) => {
  const [room, setRoom] = useState('');
  const [date, setDate] = useState<Date | undefined>();
  const [time, setTime] = useState('');

  const handleSearch = () => {
    onSearch({ room, date, time });
  };

  return (
    <div className="space-y-4 p-4 border rounded-md bg-white shadow">
      <div>
        <Label>Room Name</Label>
        <Input value={room} onChange={(e) => setRoom(e.target.value)} />
      </div>
      <div>
        <Label>Date</Label>
        <Calendar selected={date} onSelect={setDate} mode="single" className="mt-2" />
      </div>
      <div>
        <Label>Time (optional)</Label>
        <Input value={time} onChange={(e) => setTime(e.target.value)} placeholder="e.g., 14:00" />
      </div>
      <Button className="w-full" onClick={handleSearch}>Search</Button>
    </div>
  );
};
