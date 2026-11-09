import { AppController } from './app.controller';

describe('AppController', () => {
  it('reports the API as healthy', () => {
    const response = new AppController().getHealth();

    expect(response.status).toBe('ok');
    expect(response.service).toBe('chargeroad-api');
    expect(Number.isNaN(Date.parse(response.timestamp))).toBe(false);
  });
});