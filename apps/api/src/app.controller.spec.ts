import { AppController } from './app.controller';
import {DatabaseService} from './database/database.service';

describe('AppController', () => {
  const database=(query:jest.Mock)=>({pool:{query}} as unknown as DatabaseService);
  it('reports the API as healthy', () => {
    const response = new AppController(database(jest.fn())).getHealth();

    expect(response.status).toBe('ok');
    expect(response.service).toBe('chargeroad-api');
    expect(Number.isNaN(Date.parse(response.timestamp))).toBe(false);
  });
  it('reports readiness only after a successful database round trip',async()=>{
    const query=jest.fn().mockResolvedValue({rows:[{one:1}]});
    expect((await new AppController(database(query)).getReady()).database).toBe('ready');
    expect(query).toHaveBeenCalledWith('SELECT 1');
  });
  it('returns 503 for an unavailable database without leaking connection details',async()=>{
    const controller=new AppController(database(jest.fn().mockRejectedValue(new Error('private connection details'))));
    try{await controller.getReady();throw new Error('Expected unavailable readiness');}
    catch(error){expect((error as {getStatus():number}).getStatus()).toBe(503);
      expect(JSON.stringify((error as {getResponse():unknown}).getResponse())).not.toContain('private');}
    expect(controller.getHealth().status).toBe('ok');
  });
});
